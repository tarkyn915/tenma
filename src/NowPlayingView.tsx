import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle, MoreHorizontal, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { LyricsResult, PlayerTrack, Playlist, Song } from './types';
import { cn, formatTime, coverFallback } from './utils';
import { parseLyricsText } from './lyrics';
import { fetchOnlineLyrics } from './onlineLyrics';
import { TrackContextMenu } from './TrackContextMenu';
import type { NavidromeApi as ApiClient } from './api';
import { errorContent, resolveMessage, useI18n } from './i18n';
import type { MessageContent } from './i18n';

interface Props {
  track?: PlayerTrack;
  queue: PlayerTrack[];
  queueIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: boolean;
  closing: boolean;
  api: ApiClient | null;
  onClose: () => void;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onQueueSelect: (index: number) => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, song: Song) => void;
  addingSongId?: string;
  onArtist?: (name: string, artistId?: string) => void;
  onAlbum?: (song: Song) => void;
  canOpenAlbum?: (song: Song) => boolean;
}

function Artwork({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || !src) return <div className={cn('now-playing-art now-playing-art-fallback', className)} style={{ background: coverFallback(alt) }} />;
  return <img className={cn('now-playing-art', className)} src={src} alt={alt} onError={() => setFailed(true)} />;
}

export function NowPlayingView({ track, queue, queueIndex, playing, currentTime, duration, volume, muted, shuffle, repeat, closing, api, onClose, onToggle, onPrevious, onNext, onSeek, onVolume, onMute, onShuffle, onRepeat, onQueueSelect, playlists, onAddToPlaylist, addingSongId, onArtist, onAlbum, canOpenAlbum }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'queue' | 'lyrics'>('queue');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<MessageContent>('');
  const lyricsListRef = useRef<HTMLDivElement>(null);
  const lyricsScrollFrame = useRef(0);
  const animateLyricsScroll = (target: number) => {
    const list = lyricsListRef.current;
    if (!list) return;
    cancelAnimationFrame(lyricsScrollFrame.current);
    const start = list.scrollTop;
    const delta = target - start;
    if (Math.abs(delta) < 2) { list.scrollTop = target; return; }
    const duration = Math.min(260 + Math.abs(delta) * 0.35, 620);
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = progress < .5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      list.scrollTop = start + delta * eased;
      if (progress < 1) lyricsScrollFrame.current = requestAnimationFrame(step);
    };
    lyricsScrollFrame.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(lyricsScrollFrame.current), []);
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  const activeLine = useMemo(() => {
    if (!lyrics?.synced) return -1;
    let active = -1;
    lyrics.lines.forEach((line, index) => {
      if (line.start !== undefined && line.start <= currentTime) active = index;
    });
    return active;
  }, [currentTime, lyrics]);

  // Smoothly follow the active synced line, Kopuz-style, with a continuous easing
  // animation instead of the browser's interruptible smooth scroll (which stutters
  // when a new line triggers mid-animation).
  useEffect(() => {
    if (activeLine < 0) return;
    const list = lyricsListRef.current;
    const line = list?.querySelector<HTMLElement>('.lyrics-line.active');
    if (!list || !line) return;
    animateLyricsScroll(line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2);
  }, [activeLine]);

  // Opening the lyrics tab snaps straight to the playing line.
  useEffect(() => {
    if (tab !== 'lyrics') return;
    const list = lyricsListRef.current;
    const line = list?.querySelector<HTMLElement>('.lyrics-line.active');
    if (!list || !line) return;
    list.scrollTop = line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2;
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    setLyrics(null);
    setLyricsError('');
    setMenu(null);
    if (!track) return;
    const load = async () => {
      setLyricsLoading(true);
      try {
        let result: LyricsResult | null = null;
        if (api) {
          result = await api.lyrics(track);
        } else if (track.localPath && isTauri()) {
          // Local files: embedded lyrics first, then a sibling .lrc file.
          const text = await invoke<string | null>('read_local_lyrics', { path: track.localPath });
          result = text ? parseLyricsText(text) : null;
        }
        if (!result?.lines.length) {
          // Nothing embedded or served: fall back to the online lyrics database.
          result = await fetchOnlineLyrics(track);
        }
        if (!cancelled) setLyrics(result);
      } catch (error) {
        if (!cancelled) setLyricsError(errorContent(error, 'nowPlaying.failedLyrics'));
      } finally {
        if (!cancelled) setLyricsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [api, track?.id]);

  if (!track) return null;
  return <section className={cn('now-playing-screen', closing && 'leaving')} aria-label={t('nowPlaying.title')}>
    <div className="now-playing-surface">
      <header className="now-playing-toolbar">
        <button className="icon-button" aria-label={t('nowPlaying.close')} onClick={onClose}><ChevronDown size={24} /></button>
      </header>
      <div className="now-playing-grid">
        <div className="now-playing-main">
          <div className="now-playing-art-frame"><Artwork src={track.coverArt} alt={track.album} /></div>
          <div className="now-playing-meta"><div className="now-playing-title-row"><h1>{track.title}</h1><button type="button" className="now-playing-menu-button" aria-label={t('menu.moreActions')} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}><MoreHorizontal size={18} /></button></div><p>{track.artist}{track.album ? ` · ${track.album}` : ''}</p>{track.bitRate ? <small>{track.bitRate} kbps</small> : null}</div>
          <div className="now-playing-progress"><div className="now-playing-times"><span>{formatTime(currentTime)}</span><span>{formatTime(total)}</span></div><input className="progress-range" aria-label={t('player.progress')} type="range" min="0" max={total} disabled={!total} step="1" value={Math.min(currentTime, total)} style={{ '--range-progress': `${total ? currentTime / total * 100 : 0}%` } as React.CSSProperties} onChange={(event) => onSeek(Number(event.target.value))} /></div>
          <div className="now-playing-controls">
            <button aria-label={t('common.shuffle')} aria-pressed={shuffle} className={shuffle ? 'control-active' : ''} onClick={onShuffle}><Shuffle size={20} /></button>
            <button aria-label={t('common.previousTrack')} disabled={!track} onClick={onPrevious}><SkipBack size={24} fill="currentColor" /></button>
            <button className="now-playing-play" aria-label={playing ? t('common.pause') : t('common.play')} onClick={onToggle}>{playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}</button>
            <button aria-label={t('common.nextTrack')} disabled={!track} onClick={onNext}><SkipForward size={24} fill="currentColor" /></button>
            <button aria-label={t('common.repeat')} aria-pressed={repeat} className={repeat ? 'control-active' : ''} onClick={onRepeat}><Repeat size={20} /></button>
          </div>
          <div className="now-playing-volume" onWheel={(event) => { event.preventDefault(); onVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05)); }}><button className="volume-button" aria-label={muted || volume === 0 ? t('common.unmute') : t('common.mute')} onClick={onMute}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="volume-range" aria-label={t('common.volume')} type="range" min="0" max="1" step="0.01" value={volume} style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => onVolume(Number(event.target.value))} /></div>
        </div>
        <div className="now-playing-side">
          <div className="now-playing-tabs" role="tablist" aria-label={t('nowPlaying.title')}>
            <button role="tab" aria-selected={tab === 'queue'} className={cn(tab === 'queue' && 'active')} onClick={() => setTab('queue')}>{t('nowPlaying.upNext')}</button>
            <button role="tab" aria-selected={tab === 'lyrics'} className={cn(tab === 'lyrics' && 'active')} onClick={() => setTab('lyrics')}>{t('nowPlaying.lyrics')}</button>
          </div>
          {tab === 'queue' ? <div className="now-playing-queue">
            <p className="now-playing-queue-meta">{queue.length ? `${queueIndex + 1}/${queue.length}` : '0/0'} · {formatTime(total)}</p>
            <div className="now-playing-queue-list">
              {queue.map((song, index) => <button key={`${song.id}-${index}`} className={cn('now-playing-queue-track', index === queueIndex && 'current')} onClick={() => onQueueSelect(index)}>
                <span className="now-playing-queue-status">{index === queueIndex ? <Volume2 size={15} /> : null}</span>
                <Artwork src={song.coverArt} alt={song.album} className="queue-art" />
                <span className="now-playing-queue-copy"><strong>{song.title}</strong><small>{song.artist}</small></span>
                <span className="song-duration">{formatTime(song.duration)}</span>
              </button>)}
            </div>
          </div> : <div className="lyrics-panel">
            {lyricsLoading ? <div className="lyrics-state"><LoaderCircle className="spin" size={21} />{t('nowPlaying.loadingLyrics')}</div> : lyricsError ? <div className="lyrics-state"><p>{resolveMessage(lyricsError, t)}</p></div> : lyrics?.lines.length ? <div ref={lyricsListRef} className={cn('lyrics-list', lyrics.synced && 'synced')}>{lyrics.synced && <div className="lyrics-spacer" aria-hidden="true" />}{lyrics.lines.map((line, index) => { const distance = activeLine < 0 ? 0 : Math.abs(index - activeLine); return <button key={`${index}-${line.text}`} className={cn('lyrics-line', index === activeLine ? 'active' : distance <= 1 ? 'adjacent' : distance === 2 ? 'second' : 'distant')} disabled={line.start === undefined} onClick={() => line.start !== undefined && onSeek(line.start)}>{line.text}</button>; })}{lyrics.synced && <div className="lyrics-spacer" aria-hidden="true" />}</div> : <div className="lyrics-state"><p>{api || track.localPath ? t('nowPlaying.noLyrics') : t('nowPlaying.connectLyrics')}</p></div>}
          </div>}
        </div>
      </div>
    </div>
    {menu && <TrackContextMenu song={track} position={menu} playlists={playlists || []} adding={addingSongId === track.id} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum && (!canOpenAlbum || canOpenAlbum(track)) ? onAlbum : undefined} onClose={() => setMenu(null)} />}
  </section>;
}
