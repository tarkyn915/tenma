import type { LyricLine, LyricsResult } from './types';

// [mm:ss] / [mm:ss.xx] / [mm:ss.xxx], several stamps per line allowed.
const TIMESTAMP = /^\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
const METADATA = /^\[(ti|ar|al|by|offset|re|ve|length):/i;

/**
 * Parses embedded or sidecar lyrics. LRC timestamps become seekable lines;
 * plain text stays unsynced. Metadata tags such as [ti:]/[ar:]/[offset:] are skipped.
 */
export function parseLyricsText(text: string): LyricsResult {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || METADATA.test(line)) continue;
    let rest = line;
    const stamps: number[] = [];
    let match = rest.match(TIMESTAMP);
    while (match) {
      stamps.push(Number(match[1]) * 60 + Number(match[2]));
      rest = rest.slice(match[0].length);
      match = rest.match(TIMESTAMP);
    }
    const content = rest.trim();
    if (stamps.length) {
      for (const start of stamps) lines.push({ text: content, start });
    } else if (content) {
      lines.push({ text: content });
    }
  }
  const synced = lines.length > 0 && lines.every((line) => line.start !== undefined);
  if (synced) lines.sort((left, right) => (left.start ?? 0) - (right.start ?? 0));
  return { lines, synced };
}
