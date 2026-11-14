import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ListMusic, LoaderCircle, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import type { LyricsResult, PlayerTrack } from './types';
import { formatTime, coverFallback } from './utils';
import type { NavidromeApi as ApiClient } from './api';

interface Props {
  track?: PlayerTrack;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: boolean;
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
  onQueue: () => void;
}

function Artwork({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || !src) return <div className="now-playing-art now-playing-art-fallback" style={{ background: coverFallback(alt) }} />;
  return <img className="now-playing-art" src={src} alt={alt} onError={() => setFailed(true)} />;
}

export function NowPlayingView({ track, playing, currentTime, duration, volume, muted, shuffle, repeat, api, onClose, onToggle, onPrevious, onNext, onSeek, onVolume, onMute, onShuffle, onRepeat, onQueue }: Props) {
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState('');
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  const activeLine = useMemo(() => {
    if (!lyrics?.synced) return -1;
    let active = -1;
    lyrics.lines.forEach((line, index) => {
      if (line.start !== undefined && line.start <= currentTime) active = index;
    });
    return active;
  }, [currentTime, lyrics]);

  useEffect(() => {
    let cancelled = false;
    setLyrics(null);
    setLyricsError('');
    if (!track || !api) return;
    setLyricsLoading(true);
    api.lyrics(track).then((result) => {
      if (!cancelled) setLyrics(result);
    }).catch((error: unknown) => {
      if (!cancelled) setLyricsError(error instanceof Error ? error.message : 'Failed to load lyrics');
    }).finally(() => {
      if (!cancelled) setLyricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, track?.id]);

  if (!track) return null;
  return <section className="now-playing-screen" aria-label="Now playing">
    <div className="now-playing-backdrop" style={{ backgroundImage: track.coverArt ? `url(${track.coverArt})` : undefined }} />
    <div className="now-playing-surface">
      <header className="now-playing-toolbar">
        <button className="icon-button" aria-label="Close now playing" onClick={onClose}><ChevronDown size={22} /></button>
        <strong>Now Playing</strong>
        <button className="icon-button" aria-label="Open queue" onClick={onQueue}><ListMusic size={20} /></button>
      </header>
      <div className="now-playing-grid">
        <div className="now-playing-main">
          <Artwork src={track.coverArt} alt={track.album} />
          <div className="now-playing-meta"><h1>{track.title}</h1><p>{track.artist}{track.album ? ` · ${track.album}` : ''}</p></div>
          <div className="now-playing-progress"><div className="now-playing-times"><span>{formatTime(currentTime)}</span><span>{formatTime(total)}</span></div><input className="progress-range" aria-label="Playback progress" type="range" min="0" max={total} disabled={!total} step="1" value={Math.min(currentTime, total)} style={{ '--range-progress': `${total ? currentTime / total * 100 : 0}%` } as React.CSSProperties} onChange={(event) => onSeek(Number(event.target.value))} /></div>
          <div className="now-playing-controls">
            <button aria-label="Shuffle" aria-pressed={shuffle} className={shuffle ? 'control-active' : ''} onClick={onShuffle}><Shuffle size={20} /></button>
            <button aria-label="Previous track" disabled={!track} onClick={onPrevious}><SkipBack size={22} fill="currentColor" /></button>
            <button className="now-playing-play" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle}>{playing ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}</button>
            <button aria-label="Next track" disabled={!track} onClick={onNext}><SkipForward size={22} fill="currentColor" /></button>
            <button aria-label="Repeat" aria-pressed={repeat} className={repeat ? 'control-active' : ''} onClick={onRepeat}><Repeat size={20} /></button>
          </div>
          <div className="now-playing-volume" onWheel={(event) => { event.preventDefault(); onVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05)); }}><button className="volume-button" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={onMute}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="volume-range" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => onVolume(Number(event.target.value))} /></div>
        </div>
        <div className="lyrics-panel">
          <div className="lyrics-heading"><div><span className="eyebrow">LYRICS</span><h2>{track.title}</h2></div><span>{lyrics?.synced ? 'Synced lyrics' : 'Lyrics'}</span></div>
          {lyricsLoading ? <div className="lyrics-state"><LoaderCircle className="spin" size={21} />Loading lyrics…</div> : lyricsError ? <div className="lyrics-state"><p>{lyricsError}</p></div> : lyrics?.lines.length ? <div className="lyrics-list">{lyrics.lines.map((line, index) => <button key={`${index}-${line.text}`} className={index === activeLine ? 'lyrics-line active' : 'lyrics-line'} disabled={line.start === undefined} onClick={() => line.start !== undefined && onSeek(line.start)}>{line.text}</button>)}</div> : <div className="lyrics-state"><p>{api ? 'No lyrics available for this track.' : 'Connect to Navidrome to load lyrics.'}</p></div>}
        </div>
      </div>
    </div>
  </section>;
}
