import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LyricsResult } from './types';

export function useLyricClock(audioRef: RefObject<HTMLAudioElement>, lyrics: LyricsResult | null, duration: number, offset: number, visible: boolean, playing: boolean) {
  const [activeLine, setActiveLine] = useState(-1);
  const textRef = useRef<HTMLSpanElement>(null);
  const progress = useRef('0%');

  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!visible || !lyrics?.synced || !audio) {
      setActiveLine(-1);
      return;
    }
    const { lines } = lyrics;
    let index = -1;
    let start = -Infinity;
    let end = -Infinity;
    let frame = 0;

    const sync = () => {
      const time = audio.currentTime + offset;
      // Reuse the current interval on normal playback; look up a new one on seeks and line changes.
      if (time < start || time >= end) {
        index = -1;
        end = Infinity;
        for (let i = 0; i < lines.length; i++) {
          const timestamp = lines[i].start;
          if (timestamp === undefined) continue;
          if (timestamp > time) { end = timestamp; break; }
          index = i;
        }
        start = index >= 0 ? lines[index].start! : -Infinity;
        setActiveLine(index);
      }
      if (index < 0) return;
      const length = Number.isFinite(end) ? end - start : Math.max(1, (duration || start + 4) - start);
      const value = `${Math.min(1, Math.max(0, (time - start) / length)) * 100}%`;
      if (value !== progress.current) {
        progress.current = value;
        textRef.current?.style.setProperty('--lyric-progress', value);
      }
    };
    const tick = () => { sync(); frame = requestAnimationFrame(tick); };
    sync();
    if (playing) frame = requestAnimationFrame(tick);
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('seeked', sync);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('seeked', sync);
    };
  }, [audioRef, lyrics, duration, offset, visible, playing]);

  useLayoutEffect(() => {
    const text = textRef.current;
    text?.style.setProperty('--lyric-progress', progress.current);
    return () => { text?.style.removeProperty('--lyric-progress'); };
  }, [activeLine]);
  return { activeLine, textRef };
}
