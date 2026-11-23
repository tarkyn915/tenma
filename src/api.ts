import { isTauri } from '@tauri-apps/api/core';
import type { Album, ConnectionSettings, LyricsResult, Playlist, SearchResults, Song } from './types';
import { md5, normalizeServerUrl } from './utils';
import { LocalizedError } from './errors';

const VERSION = '1.16.1';
const CLIENT = 'tenma';

function explainConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not allowed on the configured scope|url not allowed/i.test(message)) return new LocalizedError('api.permissions', 'Desktop network permissions are not active. Install the latest fixed build and try again.');
  if (/timed out|timeout|timedout/i.test(message)) return new LocalizedError('api.timeout', 'The connection timed out. Check the server address, port, and network.');
  if (/dns|resolve|name or service|\u627e\u4e0d\u5230\u4e3b\u673a/i.test(message)) return new LocalizedError('api.notFound', 'The server address could not be found. Check the domain or IP address.');
  if (/failed to fetch|network|connection refused|connect error|\u8fde\u63a5\u88ab\u62d2\u7edd/i.test(message)) return new LocalizedError('api.unavailable', 'Unable to connect to the server. Check the address, port, and network.');
  return new LocalizedError('api.unavailableWithDetail', `Unable to connect to the server: ${message}`, { error: message });
}

async function requestJson(url: string) {
  // Tauri uses its Rust HTTP client in the desktop build, which avoids
  // browser CORS restrictions. The regular browser fetch remains the web fallback.
  try {
    if (isTauri()) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const response = await tauriFetch(url, { connectTimeout: 15000, maxRedirections: 3 });
      return { ok: response.ok, status: response.status, json: () => response.json() };
    }
    return await fetch(url);
  } catch (error) {
    throw explainConnectionError(error);
  }
}

type ApiEnvelope = { 'subsonic-response'?: { status?: string; error?: { code?: number; message?: string }; [key: string]: unknown } };
type ApiData = Record<string, unknown>;

export class NavidromeApi {
  readonly base: string;
  private readonly username: string;
  private readonly token: string;
  private readonly salt: string;
  private albumIndex: Album[] = [];
  private readonly albumSongCache = new Map<string, Song[]>();
  private readonly lyricsCache = new Map<string, LyricsResult>();

  constructor(settings: ConnectionSettings, password: string) {
    this.base = normalizeServerUrl(settings.server);
    this.username = settings.username;
    this.salt = Math.random().toString(36).slice(2, 12);
    this.token = md5(password + this.salt);
  }

  private async request<T extends ApiData = ApiData>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams({ u: this.username, t: this.token, s: this.salt, v: VERSION, c: CLIENT, f: 'json', ...params });
    const response = await requestJson(`${this.base}/rest/${endpoint}?${query}`);
    if (!response.ok) throw new LocalizedError('api.httpStatus', `Server responded with ${response.status}`, { status: response.status });
    const data = await response.json() as ApiEnvelope;
    const envelope = data['subsonic-response'];
    if (!envelope || envelope.status !== 'ok') {
      const errorCode = envelope?.error?.code;
      const errorMessage = envelope?.error?.message || '';
      if (errorCode === 40 || /wrong username or password|invalid username|\u5bc6\u7801\u9519\u8bef/i.test(errorMessage)) throw new LocalizedError('api.incorrectCredentials', 'Incorrect username or password. Check your credentials.');
      if (errorCode === 10) throw new LocalizedError('api.invalidRequest', 'The server address or request parameters are invalid. Check the Navidrome address.');
      if (errorMessage) throw new Error(errorMessage);
      throw new LocalizedError('api.requestFailed', 'Navidrome request failed');
    }
    return envelope as T;
  }

  async ping() { await this.request('ping.view'); }

  private coverUrl(id?: string) {
    if (!id) return undefined;
    const query = new URLSearchParams({ u: this.username, t: this.token, s: this.salt, v: VERSION, c: CLIENT, size: '600' });
    return `${this.base}/rest/getCoverArt.view?id=${encodeURIComponent(id)}&${query}`;
  }

  private streamUrl(id: string) {
    const query = new URLSearchParams({ id, u: this.username, t: this.token, s: this.salt, v: VERSION, c: CLIENT });
    return `${this.base}/rest/stream.view?${query}`;
  }

  async recentAlbums(): Promise<Album[]> {
    const data = await this.request<{ albumList2?: { album?: Record<string, unknown>[] } }>('getAlbumList2.view', { type: 'recent', size: '24' });
    const albums = data.albumList2?.album || [];
    return albums.map((item) => this.mapAlbum(item));
  }

  async allAlbums(): Promise<Album[]> {
    const albums: Album[] = [];
    const seen = new Set<string>();
    const size = 500;
    // Bound the loop as well as checking IDs: some servers ignore offset.
    for (let page = 0; page < 1000; page++) {
      const data = await this.request<{ albumList2?: { album?: Record<string, unknown>[] } }>('getAlbumList2.view', { type: 'alphabeticalByName', size: String(size), offset: String(page * size) });
      const batch = data.albumList2?.album || [];
      const fresh = batch.filter((item) => item.id && !seen.has(String(item.id)));
      if (batch.length && !fresh.length) throw new LocalizedError('api.invalidPagination', 'The server returned invalid album pagination. Please try again.');
      for (const item of fresh) { seen.add(String(item.id)); albums.push(this.mapAlbum(item)); }
      if (batch.length < size) return albums;
    }
    throw new LocalizedError('api.tooManyAlbums', 'The album count exceeds the loading limit.');
  }

  async randomSongs(size = 12): Promise<Song[]> {
    const data = await this.request<{ randomSongs?: { song?: Record<string, unknown>[] } }>('getRandomSongs.view', { size: String(Math.min(500, Math.max(1, size))) });
    return (data.randomSongs?.song || []).map((item) => this.mapSong(item));
  }

  /** Provide the album index loaded during connection for reliable song paging. */
  setAlbumIndex(albums: Album[]) {
    this.albumIndex = albums;
    this.albumSongCache.clear();
  }

  /**
   * Navidrome does not expose the non-standard getSongs.view endpoint. Build a
   * page from album details instead, fetching only albums that cover the page.
   */
  async songsPage(offset = 0, size = 25, albumIndex = this.albumIndex): Promise<Song[]> {
    const start = Math.max(0, offset);
    const count = Math.max(1, Math.min(500, size));
    if (!albumIndex.length) return [];
    let skip = start;
    const songs: Song[] = [];
    try {
      for (const album of albumIndex) {
        if (songs.length >= count) break;
        const cached = this.albumSongCache.get(album.id);
        if (cached) {
          if (skip >= cached.length) skip -= cached.length;
          else songs.push(...cached.slice(skip, skip + count - songs.length));
          continue;
        }
        const estimated = Math.max(0, album.songCount || 0);
        // A known song count lets us skip earlier albums without requesting
        // their details. Albums with an unknown count must be inspected.
        if (estimated > 0 && skip >= estimated) {
          skip -= estimated;
          continue;
        }
        const detail = await this.album(album.id);
        const albumSongs = detail.songs || [];
        if (skip >= albumSongs.length) skip -= albumSongs.length;
        else songs.push(...albumSongs.slice(skip, skip + count - songs.length));
      }
      return songs;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/auth|permission|login|incorrect username or password|\u8ba4\u8bc1|\u6743\u9650|\u767b\u5f55/i.test(message)) throw error;
      throw new LocalizedError('error.songListUnavailable', 'The song list is temporarily unavailable. Please try again later.');
    }
  }

  async album(id: string): Promise<Album> {
    const data = await this.request<{ album?: Record<string, unknown> }>('getAlbum.view', { id });
    const album = this.mapAlbum(data.album || {});
    if (album.songs) this.albumSongCache.set(id, album.songs);
    return album;
  }

  async artistAlbums(id: string): Promise<Album[]> {
    const data = await this.request<{ artist?: { album?: Record<string, unknown>[] } }>('getArtist.view', { id });
    return (data.artist?.album || []).map((item) => this.mapAlbum(item));
  }

  async createPlaylist(name: string): Promise<void> {
    await this.request('createPlaylist.view', { name: name.trim() });
  }

  async renamePlaylist(playlistId: string, name: string): Promise<void> {
    await this.request('updatePlaylist.view', { playlistId, name: name.trim() });
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request('deletePlaylist.view', { id });
  }

  async addToPlaylist(playlistId: string, songId: string): Promise<void> {
    await this.request('updatePlaylist.view', { playlistId, songIdToAdd: songId });
  }

  async removeFromPlaylist(playlistId: string, songId: string): Promise<void> {
    await this.request('updatePlaylist.view', { playlistId, songIdToRemove: songId });
  }

  async playlists(): Promise<Playlist[]> {
    const data = await this.request<{ playlists?: { playlist?: Record<string, unknown>[] } }>('getPlaylists.view');
    return (data.playlists?.playlist || []).map((item) => this.mapPlaylist(item));
  }

  async playlist(id: string): Promise<Playlist> {
    const data = await this.request<{ playlist?: Record<string, unknown> }>('getPlaylist.view', { id });
    if (!data.playlist) throw new LocalizedError('api.missingPlaylist', 'The server did not return playlist details.');
    return this.mapPlaylist(data.playlist, true);
  }

  async lyrics(song: Song): Promise<LyricsResult> {
    const cached = this.lyricsCache.get(song.id);
    if (cached) return cached;
    try {
      const data = await this.request<{ lyricsList?: { structuredLyrics?: Array<Record<string, unknown>> } }>('getLyricsBySongId.view', { id: song.id });
      const structured = data.lyricsList?.structuredLyrics || [];
      const preferred = structured.find((item) => item.synced === true) || structured[0];
      const rawLines = Array.isArray(preferred?.line) ? preferred.line : [];
      if (rawLines.length) {
        const result = { synced: rawLines.some((line) => line && line.start !== undefined), lines: rawLines.map((line) => ({ text: String((line as Record<string, unknown>).value || ''), start: Number.isFinite(Number((line as Record<string, unknown>).start)) ? Number((line as Record<string, unknown>).start) / 1000 : undefined })).filter((line) => line.text.trim()) };
        this.lyricsCache.set(song.id, result);
        return result;
      }
    } catch {
      // Some Navidrome versions only expose the legacy artist/title endpoint.
    }
    try {
      const data = await this.request<{ lyrics?: { value?: string } }>('getLyrics.view', { artist: song.artist, title: song.title });
      const lines = String(data.lyrics?.value || '').split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text }));
      const result = { synced: false, lines };
      this.lyricsCache.set(song.id, result);
      return result;
    } catch {
      const result = { synced: false, lines: [] };
      this.lyricsCache.set(song.id, result);
      return result;
    }
  }

  private mapPlaylist(item: Record<string, unknown>, detail = false): Playlist {
    const songs = Array.isArray(item.entry) ? item.entry.map((song) => this.mapSong(song as Record<string, unknown>)) : detail ? [] : undefined;
    return {
      id: String(item.id || ''), name: String(item.name || 'Untitled playlist'),
      comment: String(item.comment || ''), owner: String(item.owner || ''), public: item.public === true,
      songCount: Number(item.songCount ?? songs?.length ?? 0), duration: Number(item.duration || 0),
      coverArt: this.coverUrl(item.coverArt ? String(item.coverArt) : undefined), songs
    };
  }

  async search(query: string): Promise<SearchResults> {
    const data = await this.request<{ searchResult3?: { song?: Record<string, unknown>[]; album?: Record<string, unknown>[]; artist?: Record<string, unknown>[] } }>('search3.view', { query, songCount: '30', albumCount: '20', artistCount: '20' });
    const result = data.searchResult3 || {};
    return {
      songs: (result.song || []).map((item) => this.mapSong(item)),
      albums: (result.album || []).map((item) => this.mapAlbum(item)),
      artists: (result.artist || []).map((item) => ({ id: String(item.id || item.name), name: String(item.name || '') }))
    };
  }

  private mapAlbum(item: Record<string, unknown>): Album {
    return { id: String(item.id || ''), name: String(item.name || 'Untitled album'), artist: String(item.artist || 'Unknown artist'), artistId: item.artistId ? String(item.artistId) : undefined, coverArt: this.coverUrl(item.coverArt ? String(item.coverArt) : String(item.id || '')), songCount: Number(item.songCount || 0), year: item.year ? Number(item.year) : undefined, created: item.created ? String(item.created) : undefined, songs: Array.isArray(item.song) ? item.song.map((song) => this.mapSong(song as Record<string, unknown>)) : undefined };
  }

  private mapSong(item: Record<string, unknown>): Song {
    const id = String(item.id || '');
    return { id, title: String(item.title || 'Untitled song'), artist: String(item.artist || 'Unknown artist'), artistId: item.artistId ? String(item.artistId) : undefined, album: String(item.album || ''), albumId: item.albumId ? String(item.albumId) : undefined, duration: item.duration ? Number(item.duration) : undefined, track: item.track ? Number(item.track) : undefined, bitRate: item.bitRate ? Number(item.bitRate) : undefined, coverArt: this.coverUrl(item.coverArt ? String(item.coverArt) : undefined), streamUrl: this.streamUrl(id) };
  }
}
