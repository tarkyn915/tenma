import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLyricClock } from './useLyricClock';
import { ChevronDown, LoaderCircle, Minus, MoreHorizontal, Pause, Play, Plus, Repeat, RotateCcw, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { SettingSelect } from './SettingsView';
import type { LyricsResult, PlayerTrack, Playlist, Song } from './types';
import { cn, formatTime, coverFallback } from './utils';
import { parseLyricsText } from './lyrics';
import { fetchOnlineLyrics } from './onlineLyrics';
import { TrackContextMenu } from './TrackContextMenu';
import type { NavidromeApi as ApiClient } from './api';
import { errorContent, resolveMessage, useI18n } from './i18n';
import type { MessageContent } from './i18n';

interface Props {
  audioRef: RefObject<HTMLAudioElement>;
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

function lyricScrollTop(list: HTMLElement, line: HTMLElement) {
  return line.offsetTop + line.offsetHeight / 2 - list.clientHeight * 0.4;
}

// Memoised so a line change only re-renders lines whose distance class changed.
const LyricLine = memo(function LyricLine({ text, cls, start, active, textRef, onSeek }: { text: string; cls: string; start?: number; active: boolean; textRef: RefObject<HTMLSpanElement>; onSeek: (time: number) => void }) {
  return <button className={cn('lyrics-line', cls)} disabled={start === undefined} onClick={() => start !== undefined && onSeek(start)}>
    <span className="lyrics-line-text" ref={active ? textRef : undefined}>{text}</span>
  </button>;
});

function Artwork({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || !src) return <div className={cn('now-playing-art now-playing-art-fallback', className)} style={{ background: coverFallback(alt) }} />;
  return <img className={cn('now-playing-art', className)} src={src} alt={alt} onError={() => setFailed(true)} />;
}

export function NowPlayingView({ audioRef, track, queue, queueIndex, playing, currentTime, duration, volume, muted, shuffle, repeat, closing, api, onClose, onToggle, onPrevious, onNext, onSeek, onVolume, onMute, onShuffle, onRepeat, onQueueSelect, playlists, onAddToPlaylist, addingSongId, onArtist, onAlbum, canOpenAlbum }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'queue' | 'lyrics'>('queue');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<MessageContent>('');
  const [lyricsSource, setLyricsSource] = useState<'auto' | 'local' | 'server' | 'online'>('auto');
  // Lyrics offset is remembered per song (tenma.lyricsOffset.<id>), clamped to ±30s.
  const offsetKey = `tenma.lyricsOffset.${track?.id ?? ''}`;
  const readOffset = () => { try { const n = Number(globalThis.localStorage?.getItem(offsetKey) || 0); return Number.isFinite(n) ? n : 0; } catch { return 0; } };
  const [lyricsOffset, setLyricsOffsetState] = useState(readOffset);
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);
  useEffect(() => { setLyricsOffsetState(readOffset()); setOffsetDraft(null); }, [offsetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLyricsOffset = (next: number | ((value: number) => number)) => setLyricsOffsetState((value) => {
    const raw = typeof next === 'function' ? next(value) : next;
    const clamped = Math.round(Math.min(30, Math.max(-30, raw)) * 100) / 100;
    try { if (clamped) globalThis.localStorage?.setItem(offsetKey, String(clamped)); else globalThis.localStorage?.removeItem(offsetKey); } catch { /* optional */ }
    return clamped;
  });
  const commitOffsetDraft = () => { if (offsetDraft === null) return; const n = Number(offsetDraft.replace(/s$/i, '').trim()); if (offsetDraft.trim() !== '' && Number.isFinite(n)) setLyricsOffset(n); setOffsetDraft(null); };
  const lyricsListRef = useRef<HTMLDivElement>(null);
  // Synced lyrics move as one translated track (CSS transition) for smooth scrolling.
  const lyricsTrackRef = useRef<HTMLDivElement>(null);
  const manualY = useRef<number | null>(null);
  const followY = useRef(0);
  const followTimer = useRef(0);
  const [detached, setDetached] = useState(false);
  const applyY = (y: number, mode: 'follow' | 'manual' | 'snap' = 'follow') => {
    const el = lyricsTrackRef.current;
    if (!el) return;
    el.style.transition = mode === 'snap' ? 'none' : mode === 'manual' ? 'transform .18s ease-out' : '';
    el.style.transform = `translate3d(0, ${-y}px, 0)`;
    if (mode === 'snap') { void el.offsetHeight; requestAnimationFrame(() => requestAnimationFrame(() => { if (lyricsTrackRef.current === el) el.style.transition = ''; })); }
  };
  const followTarget = () => {
    const list = lyricsListRef.current;
    const line = list?.querySelector<HTMLElement>('.lyrics-line.active');
    return list && line ? lyricScrollTop(list, line) : null;
  };
  const backToCurrent = () => {
    clearTimeout(followTimer.current);
    manualY.current = null;
    setDetached(false);
    const y = followTarget();
    if (y !== null) { followY.current = y; applyY(y); }
  };
  const onLyricsWheel = (event: React.WheelEvent) => {
    const list = lyricsListRef.current, trackEl = lyricsTrackRef.current;
    if (!lyrics?.synced || !list || !trackEl) return;
    const max = Math.max(0, trackEl.scrollHeight - list.clientHeight);
    manualY.current = Math.min(max, Math.max(0, (manualY.current ?? followY.current) + event.deltaY));
    applyY(manualY.current, 'manual');
    setDetached(true);
    clearTimeout(followTimer.current);
    followTimer.current = window.setTimeout(backToCurrent, 3000);
  };
  useEffect(() => () => clearTimeout(followTimer.current), []);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const seekLine = useCallback((time: number) => seekRef.current(time), []);
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  const { activeLine, textRef } = useLyricClock(audioRef, lyrics, total, lyricsOffset, tab === 'lyrics' && !closing, playing);

  // Smoothly follow the active synced line with a continuous easing
  // animation instead of the browser's interruptible smooth scroll (which stutters
  // when a new line triggers mid-animation).
  useEffect(() => {
    if (activeLine < 0 || manualY.current !== null) return;
    const y = followTarget();
    if (y !== null) { followY.current = y; applyY(y); }
  }, [activeLine]);

  // Opening the lyrics tab snaps straight to the playing line.
  useEffect(() => {
    if (tab !== 'lyrics') return;
    manualY.current = null;
    setDetached(false);
    const y = followTarget();
    if (y !== null) { followY.current = y; applyY(y, 'snap'); }
  }, [tab, lyrics]);

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
        const loadLocal = async () => {
          if (!track.localPath || !isTauri()) return null;
          const text = await invoke<string | null>('read_local_lyrics', { path: track.localPath });
          return text ? parseLyricsText(text) : null;
        };
        if (lyricsSource === 'local') {
          result = await loadLocal();
        } else if (lyricsSource === 'server') {
          result = api ? await api.lyrics(track) : null;
        } else if (lyricsSource === 'online') {
          result = await fetchOnlineLyrics(track);
        } else {
          if (api) result = await api.lyrics(track);
          else result = await loadLocal();
          if (!result?.lines.length) result = await fetchOnlineLyrics(track);
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
  }, [api, track?.id, lyricsSource]);

  if (!track) return null;
  return <section className={cn('now-playing-screen', closing && 'leaving')} aria-label={t('nowPlaying.title')}>
    <div key={track.coverArt || 'none'} className="now-playing-backdrop" aria-hidden="true" style={track.coverArt ? { backgroundImage: `url("${track.coverArt}")` } : undefined} />
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
            <div className="lyrics-tools">
              <SettingSelect label={t('nowPlaying.lyricsSource')} value={lyricsSource} options={[{ value: 'auto', label: t('nowPlaying.sourceAuto') }, { value: 'local', label: t('nowPlaying.sourceLocal') }, { value: 'server', label: t('nowPlaying.sourceServer') }, { value: 'online', label: t('nowPlaying.sourceOnline') }]} onChange={(value) => setLyricsSource(value as typeof lyricsSource)} />
              <div className={`lyrics-offset${lyricsOffset ? ' nonzero' : ''}`} aria-label={t('nowPlaying.lyricsOffset')}>
                <button type="button" aria-label={t('nowPlaying.offsetBack')} onClick={() => setLyricsOffset((value) => value - 0.5)}><Minus size={14} /></button>
                <input className="lyrics-offset-input" type="text" inputMode="decimal" aria-label={t('nowPlaying.lyricsOffset')} value={offsetDraft ?? `${lyricsOffset > 0 ? '+' : ''}${Number.isInteger(lyricsOffset * 10) ? lyricsOffset.toFixed(1) : lyricsOffset.toFixed(2)}s`} onFocus={(event) => { setOffsetDraft(String(lyricsOffset)); requestAnimationFrame(() => event.target.select()); }} onChange={(event) => setOffsetDraft(event.target.value)} onBlur={commitOffsetDraft} onKeyDown={(event) => { if (event.key === 'Enter') { commitOffsetDraft(); event.currentTarget.blur(); } else if (event.key === 'Escape') { setOffsetDraft(null); requestAnimationFrame(() => (event.target as HTMLInputElement).blur()); } }} />
                <button type="button" aria-label={t('nowPlaying.offsetForward')} onClick={() => setLyricsOffset((value) => value + 0.5)}><Plus size={14} /></button>
                {lyricsOffset ? <button type="button" className="lyrics-offset-reset" aria-label={t('nowPlaying.offsetReset')} title={t('nowPlaying.offsetReset')} onClick={() => setLyricsOffset(0)}><RotateCcw size={13} /></button> : null}
              </div>
            </div>
            {lyricsLoading ? <div className="lyrics-state"><LoaderCircle className="spin" size={21} />{t('nowPlaying.loadingLyrics')}</div> : lyricsError ? <div className="lyrics-state"><p>{resolveMessage(lyricsError, t)}</p></div> : lyrics?.lines.length ? <div ref={lyricsListRef} className={cn('lyrics-list', lyrics.synced && 'synced')} onWheel={onLyricsWheel}><div ref={lyricsTrackRef} className="lyrics-track">{lyrics.synced && <div className="lyrics-spacer" aria-hidden="true" />}{lyrics.lines.map((line, index) => { const distance = activeLine < 0 ? 1 : Math.abs(index - activeLine); const isActive = index === activeLine; return <LyricLine key={`${index}-${line.text}`} text={line.text} start={line.start} active={isActive} textRef={textRef} onSeek={seekLine} cls={isActive ? 'active' : distance <= 1 ? 'adjacent' : distance === 2 ? 'second' : distance <= 12 ? 'distant' : 'far'} />; })}{lyrics.synced && <div className="lyrics-spacer" aria-hidden="true" />}</div></div> : <div className="lyrics-state"><p>{api || track.localPath ? t('nowPlaying.noLyrics') : t('nowPlaying.connectLyrics')}</p></div>}
            {detached && lyrics?.synced ? <button type="button" className="lyrics-follow" onClick={backToCurrent}>{t('nowPlaying.backToCurrent')}</button> : null}
          </div>}
        </div>
      </div>
    </div>
    {menu && <TrackContextMenu song={track} position={menu} playlists={playlists || []} adding={addingSongId === track.id} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum && (!canOpenAlbum || canOpenAlbum(track)) ? onAlbum : undefined} onClose={() => setMenu(null)} />}
  </section>;
}
