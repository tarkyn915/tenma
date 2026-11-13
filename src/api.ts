import { isTauri } from '@tauri-apps/api/core';
import type { Album, ConnectionSettings, Playlist, SearchResults, Song } from './types';
import { md5, normalizeServerUrl } from './utils';

const VERSION = '1.16.1';
const CLIENT = 'tenma';

function explainConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not allowed on the configured scope|url not allowed/i.test(message)) return new Error('桌面版网络权限未生效，请安装本次修复版后重试。');
  if (/timed out|timeout|timedout/i.test(message)) return new Error('连接服务器超时，请检查地址、端口和网络。');
  if (/dns|resolve|name or service|找不到主机/i.test(message)) return new Error('找不到服务器地址，请检查域名或 IP 是否正确。');
  if (/failed to fetch|network|连接被拒绝|connection refused|connect error/i.test(message)) return new Error('无法连接服务器，请检查地址、端口和网络。');
  return new Error(`无法连接服务器：${message}`);
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

  constructor(settings: ConnectionSettings, password: string) {
    this.base = normalizeServerUrl(settings.server);
    this.username = settings.username;
    this.salt = Math.random().toString(36).slice(2, 12);
    this.token = md5(password + this.salt);
  }

  private async request<T extends ApiData = ApiData>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams({ u: this.username, t: this.token, s: this.salt, v: VERSION, c: CLIENT, f: 'json', ...params });
    const response = await requestJson(`${this.base}/rest/${endpoint}?${query}`);
    if (!response.ok) throw new Error(`服务器响应 ${response.status}`);
    const data = await response.json() as ApiEnvelope;
    const envelope = data['subsonic-response'];
    if (!envelope || envelope.status !== 'ok') {
      const errorCode = envelope?.error?.code;
      const errorMessage = envelope?.error?.message || '';
      if (errorCode === 40 || /wrong username or password|invalid username|密码错误/i.test(errorMessage)) throw new Error('用户名或密码错误，请检查账号和密码。');
      if (errorCode === 10) throw new Error('服务器地址或请求参数无效，请检查 Navidrome 地址。');
      throw new Error(errorMessage || 'Navidrome 请求失败');
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
      if (batch.length && !fresh.length) throw new Error('服务器未正确返回专辑分页，请重试');
      for (const item of fresh) { seen.add(String(item.id)); albums.push(this.mapAlbum(item)); }
      if (batch.length < size) return albums;
    }
    throw new Error('专辑数量超过单次加载上限');
  }

  async randomSongs(size = 10): Promise<Song[]> {
    const data = await this.request<{ randomSongs?: { song?: Record<string, unknown>[] } }>('getRandomSongs.view', { size: String(Math.min(12, Math.max(1, size))) });
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
      if (/认证|权限|登录/i.test(message)) throw error;
      throw new Error('歌曲列表暂时无法加载，可稍后重试');
    }
  }

  async album(id: string): Promise<Album> {
    const data = await this.request<{ album?: Record<string, unknown> }>('getAlbum.view', { id });
    const album = this.mapAlbum(data.album || {});
    if (album.songs) this.albumSongCache.set(id, album.songs);
    return album;
  }

  async playlists(): Promise<Playlist[]> {
    const data = await this.request<{ playlists?: { playlist?: Record<string, unknown>[] } }>('getPlaylists.view');
    return (data.playlists?.playlist || []).map((item) => this.mapPlaylist(item));
  }

  async playlist(id: string): Promise<Playlist> {
    const data = await this.request<{ playlist?: Record<string, unknown> }>('getPlaylist.view', { id });
    if (!data.playlist) throw new Error('服务器未返回歌单详情');
    return this.mapPlaylist(data.playlist, true);
  }

  private mapPlaylist(item: Record<string, unknown>, detail = false): Playlist {
    const songs = Array.isArray(item.entry) ? item.entry.map((song) => this.mapSong(song as Record<string, unknown>)) : detail ? [] : undefined;
    return {
      id: String(item.id || ''), name: String(item.name || '未命名歌单'),
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
    return { id: String(item.id || ''), name: String(item.name || '未命名专辑'), artist: String(item.artist || '未知艺人'), artistId: item.artistId ? String(item.artistId) : undefined, coverArt: this.coverUrl(item.coverArt ? String(item.coverArt) : String(item.id || '')), songCount: Number(item.songCount || 0), year: item.year ? Number(item.year) : undefined, created: item.created ? String(item.created) : undefined, songs: Array.isArray(item.song) ? item.song.map((song) => this.mapSong(song as Record<string, unknown>)) : undefined };
  }

  private mapSong(item: Record<string, unknown>): Song {
    const id = String(item.id || '');
    return { id, title: String(item.title || '未命名歌曲'), artist: String(item.artist || '未知艺人'), artistId: item.artistId ? String(item.artistId) : undefined, album: String(item.album || ''), albumId: item.albumId ? String(item.albumId) : undefined, duration: item.duration ? Number(item.duration) : undefined, track: item.track ? Number(item.track) : undefined, coverArt: this.coverUrl(item.coverArt ? String(item.coverArt) : undefined), streamUrl: this.streamUrl(id) };
  }
}
