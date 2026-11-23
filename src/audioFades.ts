// Perceptual loudness: a linear amplitude slider feels too loud at the bottom of
// its range, so map it quadratically (0.1 -> 0.01, 0.5 -> 0.25).
export function perceivedVolume(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped;
}

const fadeFrames = new WeakMap<HTMLAudioElement, number>();

/**
 * Eases the audio element's volume towards a target over `duration` ms and calls
 * `onComplete` when finished. The animation is frame-count based so it also works
 * in headless test environments where rAF is patched to setTimeout.
 */
export function fadeAudio(audio: HTMLAudioElement, target: number, duration = 240, onComplete?: () => void) {
  cancelAnimationFrame(fadeFrames.get(audio) || 0);
  const start = audio.volume;
  const delta = target - start;
  if (Math.abs(delta) < 0.005) {
    audio.volume = target;
    onComplete?.();
    return;
  }
  const startTime = { current: undefined as number | undefined };
  // Track progress by the rAF timestamp so fades also complete in headless test
  // environments where rAF is patched to a zero-delay timer with a fake clock.
  const maxFrames = Math.max(1, Math.round(duration / 16)) + 8;
  let frame = 0;
  const step = (now: number) => {
    startTime.current ??= now;
    frame++;
    const progress = Math.max(Math.min((now - startTime.current) / duration, 1), Math.min(frame / maxFrames, 1));
    const eased = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
    audio.volume = start + delta * eased;
    if (progress < 1) fadeFrames.set(audio, requestAnimationFrame(step));
    else {
      fadeFrames.delete(audio);
      onComplete?.();
    }
  };
  fadeFrames.set(audio, requestAnimationFrame(step));
}
