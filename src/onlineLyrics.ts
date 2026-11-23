import { isTauri } from '@tauri-apps/api/core';
import type { LyricsResult, Song } from './types';
import { parseLyricsText } from './lyrics';
import { LocalizedError } from './errors';

// LRCLIB (https://lrclib.net) is a free lyrics database, no API key required.
const ENDPOINT = 'https://lrclib.net/api';

interface LrcLibEntry {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

async function requestJson(url: string): Promise<unknown> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  if (isTauri()) {
    // The desktop Rust HTTP client avoids browser CORS restrictions.
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    response = await tauriFetch(url, { connectTimeout: 12000, maxRedirections: 3 });
  } else {
    response = await fetch(url);
  }
  if (response.status === 404) return null; // no lyrics for this song
  if (!response.ok) throw new LocalizedError('nowPlaying.failedLyrics', `The lyrics service returned HTTP ${response.status}.`);
  return response.json();
}

// Compare titles/artists loosely (case, spacing, punctuation) so a Chinese song
// never ends up with the lyrics of a same-named English song.
const normalize = (value?: string) => (value || '').toLowerCase().replace(/[\s\-_·、，。！？!?,.'"()（）\[\]【】]/g, '');

function pickBest(entries: LrcLibEntry[], song: Pick<Song, 'title' | 'artist' | 'duration'>): LrcLibEntry | undefined {
  const wantTitle = normalize(song.title);
  const wantArtist = normalize(song.artist);
  const candidates = entries.filter((entry) => {
    if (entry.instrumental) return false;
    if (!(entry.syncedLyrics?.trim() || entry.plainLyrics?.trim())) return false;
    const gotTitle = normalize(entry.trackName);
    // Drop candidates whose title shares nothing with the requested song.
    if (gotTitle && wantTitle && gotTitle !== wantTitle && !gotTitle.includes(wantTitle) && !wantTitle.includes(gotTitle)) return false;
    return true;
  });
  if (!candidates.length) return undefined;
  const score = (entry: LrcLibEntry) => {
    const title = normalize(entry.trackName);
    const artist = normalize(entry.artistName);
    return (title === wantTitle ? 4 : 0) +
      (wantArtist && artist && (artist === wantArtist || artist.includes(wantArtist) || wantArtist.includes(artist)) ? 3 : 0) +
      (entry.syncedLyrics?.trim() ? 2 : 1) +
      (song.duration && entry.duration && Math.abs(entry.duration - song.duration) < 3 ? 1 : 0);
  };
  return [...candidates].sort((left, right) => score(right) - score(left))[0];
}

function toResult(entry: LrcLibEntry | undefined): LyricsResult | null {
  if (!entry) return null;
  const text = entry.syncedLyrics?.trim() ? entry.syncedLyrics : entry.plainLyrics;
  return text?.trim() ? parseLyricsText(text) : null;
}

/**
 * Looks up lyrics online: exact match first, then a fuzzy search that prefers
 * synced lyrics close to the track duration. Returns null when nothing matches.
 */
export async function fetchOnlineLyrics(song: Pick<Song, 'title' | 'artist' | 'album' | 'duration'>): Promise<LyricsResult | null> {
  const title = song.title.trim();
  if (!title) return null;
  const params = new URLSearchParams({ track_name: title });
  if (song.artist.trim()) params.set('artist_name', song.artist.trim());
  if (song.album?.trim()) params.set('album_name', song.album.trim());
  const exactParams = new URLSearchParams(params);
  if (song.duration && song.duration > 0) exactParams.set('duration', String(Math.round(song.duration)));
  const exact = await requestJson(`${ENDPOINT}/get?${exactParams}`) as LrcLibEntry | null;
  if (exact) return toResult(pickBest([exact], song));
  const found = await requestJson(`${ENDPOINT}/search?${params}`) as LrcLibEntry[] | null;
  return toResult(pickBest(found || [], song));
}
