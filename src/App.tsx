import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Album as AlbumIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, Home, Library, ListMusic, LoaderCircle, Menu, Minus, Music2, Pause, Play, Plus, Repeat, Search, Settings, Shuffle, SkipBack, SkipForward, Square, Users, Volume2, X } from 'lucide-react';
import { NavidromeApi } from './api';
import { demoAlbums, demoPlaylists, demoSongs, demoSearch } from './demoData';
import type { Album, AppMode, ConnectionSettings, Playlist, PlayerTrack, SearchResults, Song } from './types';
import { cn, coverFallback, formatTime } from './utils';

import { SettingsView, loadPreferences, serverLabel } from './SettingsView';
import type { Page } from './SettingsView';
import { PlaylistsView } from './PlaylistsView';

const LIBRARY_PAGE_SIZE = 25;
const GRID_PAGE_SIZE = 24;

const storageGet = (key: string) => { try { return globalThis.localStorage?.getItem(key) || ''; } catch { return ''; } };
const storageSet = (key: string, value: string) => { try { globalThis.localStorage?.setItem(key, value); } catch { /* Optional browser storage must not block the app. */ } };
const storageRemove = (key: string) => { try { globalThis.localStorage?.removeItem(key); } catch { /* Optional browser storage must not block the app. */ } };

const storedSettings: ConnectionSettings = {
  serverName: storageGet('northstar.serverName'),
  server: storageGet('northstar.server'),
  username: storageGet('northstar.username')
};

function Cover({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed || !src ? <div className={cn('cover-fallback', className)} style={{ background: coverFallback(alt) }}><Disc3 size={30} /></div> : <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function AlbumCard({ album, onOpen }: { album: Album; onOpen: (album: Album) => void }) {
  return <button className="album-card" onClick={() => onOpen(album)}>
    <div className="album-art-wrap"><Cover src={album.coverArt} alt={album.name} className="album-art" /><span className="play-overlay"><Play fill="currentColor" size={18} /></span></div>
    <span className="album-name">{album.name}</span><span className="album-artist">{album.artist}</span>
  </button>;
}

function WindowControls() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { setDesktop(isTauri()); }, []);
  if (!desktop) return null;
  const currentWindow = getCurrentWindow();
  const runWindowAction = (event: React.MouseEvent<HTMLButtonElement>, action: () => Promise<void>) => {
    event.preventDefault();
    event.stopPropagation();
    void action().catch((error: unknown) => console.error('窗口控制失败', error));
  };
  return <div className="window-controls" aria-label="窗口控制" onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" aria-label="最小化" onClick={(event) => runWindowAction(event, () => currentWindow.minimize())}><Minus size={14} /></button>
    <button type="button" aria-label="最大化" onClick={(event) => runWindowAction(event, () => currentWindow.toggleMaximize())}><Square size={12} /></button>
    <button type="button" className="window-close" aria-label="关闭" onClick={(event) => runWindowAction(event, () => currentWindow.close())}><X size={15} /></button>
  </div>;
}

function sampleSongs(songs: Song[], size = 10) {
  const shuffled = [...songs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, size);
}

function indexedSongCount(albums: Album[]) {
  return albums.reduce((total, album) => total + (album.songCount || album.songs?.length || 0), 0);
}

type ArtistDetail = { name: string; albums: Album[]; songs: Song[] };

function App() {
  const [mode, setMode] = useState<AppMode>('demo');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [navigation, setNavigation] = useState<{ pages: Page[]; index: number }>(() => ({ pages: [loadPreferences().startPage], index: 0 }));
  const [connectedSettings, setConnectedSettings] = useState<ConnectionSettings | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>(demoPlaylists);
  const [playlistsError, setPlaylistsError] = useState('');
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState('');
  const playlistRequest = useRef(0);
  const sessionRequest = useRef(0);
  const page = navigation.pages[navigation.index];
  const [showQueue, setShowQueue] = useState(false);
  const [albums, setAlbums] = useState<Album[]>(demoAlbums);
  const [recentAlbums, setRecentAlbums] = useState<Album[]>(demoAlbums);
  const [albumsError, setAlbumsError] = useState('');
  const [randomSongs, setRandomSongs] = useState<Song[]>(() => sampleSongs(demoSongs));
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomError, setRandomError] = useState('');
  const randomRequest = useRef(0);
  const [selectedArtist, setSelectedArtist] = useState<ArtistDetail | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistError, setArtistError] = useState('');
  const artistRequest = useRef(0);
  const [api, setApi] = useState<NavidromeApi | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState('');
  const albumRequest = useRef(0);
  const [query, setQuery] = useState('');
  const [focusLibrarySearch, setFocusLibrarySearch] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults>({ songs: [], albums: [], artists: [] });
  const [librarySongs, setLibrarySongs] = useState<Song[]>(demoSongs);
  const [librarySongPage, setLibrarySongPage] = useState(0);
  const [libraryKnownPageCount, setLibraryKnownPageCount] = useState(1);
  const [librarySongLoading, setLibrarySongLoading] = useState(false);
  const [librarySongError, setLibrarySongError] = useState('');
  const [libraryHasNext, setLibraryHasNext] = useState(false);
  const librarySongRequest = useRef(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [settings, setSettings] = useState(storedSettings);
  const [rememberPassword, setRememberPasswordState] = useState(() => storageGet('northstar.rememberPassword') === 'true');
  const [password, setPassword] = useState(() => storageGet('northstar.rememberPassword') === 'true' ? storageGet('northstar.password') : '');
  const [isConnected, setIsConnected] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [connectionViewKey, setConnectionViewKey] = useState(0);
  const serverSwitcherRef = useRef<HTMLDivElement>(null);
  const serverButtonRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => loadPreferences().defaultVolume);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : undefined;

  useEffect(() => {
    if (!serverMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!serverSwitcherRef.current?.contains(event.target as Node)) setServerMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setServerMenuOpen(false); serverButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [serverMenuOpen]);

  useEffect(() => { storageSet('northstar.preferences', JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { setVolume(preferences.defaultVolume); }, [preferences.defaultVolume]);

  const setRememberPassword = (value: boolean) => {
    setRememberPasswordState(value);
    storageSet('northstar.rememberPassword', String(value));
    if (!value) { storageRemove('northstar.password'); setPassword(''); }
    else if (password) storageSet('northstar.password', password);
  };

  useEffect(() => {
    if (!query.trim()) { setSearchResults({ songs: [], albums: [], artists: [] }); setLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try { const results = api ? await api.search(query.trim()) : demoSearch(query.trim()); if (!cancelled) setSearchResults(results); }
      catch (error) { if (!cancelled) setMessage({ type: 'error', text: error instanceof Error ? error.message : '搜索失败' }); }
      finally { if (!cancelled) setLoading(false); }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, query]);

  useEffect(() => {
    if (!focusLibrarySearch || page !== 'library') return;
    const timer = window.setTimeout(() => document.querySelector<HTMLInputElement>('.library-search-input')?.focus(), 0);
    setFocusLibrarySearch(false);
    return () => window.clearTimeout(timer);
  }, [focusLibrarySearch, page]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.src = currentTrack.streamUrl || '';
    audio.volume = volume;
    audio.load();
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [currentIndex, currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setMessage(null);
    const session = ++sessionRequest.current;
    const nextApi = new NavidromeApi(settings, password);
    try {
      await nextApi.ping();
      if (session !== sessionRequest.current) return;
      const [recent, all, lists, random] = await Promise.all([
        nextApi.recentAlbums().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Album[], error: error instanceof Error ? error.message : '最近专辑加载失败' })),
        nextApi.allAlbums().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Album[], error: error instanceof Error ? error.message : '完整专辑加载失败' })),
        nextApi.playlists().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Playlist[], error: error instanceof Error ? error.message : '歌单加载失败' })),
        nextApi.randomSongs().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: error instanceof Error ? error.message : '随机歌曲加载失败' }))
      ]);
      if (all.value.length) nextApi.setAlbumIndex(all.value);
      const songs = await nextApi.songsPage(0, LIBRARY_PAGE_SIZE, all.value).then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: error instanceof Error ? error.message : '歌曲列表暂时无法加载，可稍后重试' }));
      if (session !== sessionRequest.current) return;
      const saved = { ...settings, server: nextApi.base, serverName: serverLabel(settings) };
      playlistRequest.current++; albumRequest.current++; artistRequest.current++; randomRequest.current++; setPlaylistsLoading(false); setRandomLoading(false);
      audioRef.current?.pause(); setQueue([]); setCurrentIndex(-1); setCurrentTime(0); setDuration(0);
      setSelectedAlbum(null); setSelectedPlaylist(null); setSelectedArtist(null); setSearchResults({ songs: [], albums: [], artists: [] });
      setApi(nextApi); setMode('server'); setAlbums(all.value); setRecentAlbums(recent.value); setAlbumsError(all.error);
      const indexedSongs = indexedSongCount(all.value);
      const estimatedPages = indexedSongs > 0 ? Math.max(1, Math.ceil(indexedSongs / LIBRARY_PAGE_SIZE)) : 1;
      const initialPageCount = songs.value.length === LIBRARY_PAGE_SIZE ? Math.max(2, estimatedPages) : 1;
      setLibrarySongs(songs.value); setLibrarySongPage(0); setLibraryKnownPageCount(initialPageCount); setLibraryHasNext(songs.value.length === LIBRARY_PAGE_SIZE); setLibrarySongError(songs.error);
      setRandomSongs(random.value); setRandomError(random.error); setPlaylists(lists.value); setPlaylistsError(lists.error ? `歌单加载失败：${lists.error}，可点击刷新重试。` : '');
      // Keep the password in memory for this session even when local saving is
      // disabled, so enabling the toggle after a successful connection works.
      setIsConnected(true); setConnectedSettings(saved); setSettings(saved);
      storageSet('northstar.server', saved.server); storageSet('northstar.username', saved.username); storageSet('northstar.serverName', saved.serverName);
      storageSet('northstar.rememberPassword', String(rememberPassword));
      if (rememberPassword) storageSet('northstar.password', password); else storageRemove('northstar.password');
      const errors = [all.error && `完整专辑：${all.error}`, recent.error && `最近专辑：${recent.error}`, lists.error && `歌单：${lists.error}`, random.error && `推荐歌曲：${random.error}`, songs.error && `歌曲列表：${songs.error}`].filter(Boolean);
      setMessage({ type: errors.length ? 'error' : 'success', text: `已连接到 ${saved.serverName}${errors.length ? `；部分内容加载失败（${errors.join('；')}）` : ''}` });
    } catch (error) { if (session === sessionRequest.current) setMessage({ type: 'error', text: error instanceof Error ? error.message : '连接失败，请检查地址与账号' }); }
    finally { if (session === sessionRequest.current) setLoading(false); }
  };

  const useDemo = () => {
    sessionRequest.current++; playlistRequest.current++; albumRequest.current++; artistRequest.current++; randomRequest.current++;
    audioRef.current?.pause(); if (audioRef.current) { audioRef.current.removeAttribute('src'); audioRef.current.load(); }
    setPlaying(false); setLoading(false); setQueue([]); setCurrentIndex(-1); setCurrentTime(0); setDuration(0); setShowQueue(false);
    setMode('demo'); setApi(null); setAlbums(demoAlbums); setRecentAlbums(demoAlbums); setAlbumsError('');
    const demoPageCount = Math.max(1, Math.ceil(demoSongs.length / LIBRARY_PAGE_SIZE));
    setLibrarySongs(demoSongs); setLibrarySongPage(0); setLibraryKnownPageCount(demoPageCount); setLibraryHasNext(demoPageCount > 1); setLibrarySongError('');
    setRandomSongs(sampleSongs(demoSongs)); setRandomError(''); setRandomLoading(false); setSelectedArtist(null); setPlaylists(demoPlaylists); setPlaylistsError(''); setPlaylistsLoading(false);
    setIsConnected(false); setConnectedSettings(null); setSelectedAlbum(null); setSelectedPlaylist(null); setQuery('');
    if (!rememberPassword) setPassword('');
    setMessage({ type: 'success', text: '已切换至本地预览' });
  };
  const renameServer = (name: string) => {
    setConnectedSettings((current) => current ? { ...current, serverName: name } : null);
    setSettings((current) => ({ ...current, serverName: name }));
    storageSet('northstar.serverName', name);
  };
  const refreshPlaylists = async () => {
    if (!api) { setPlaylists(demoPlaylists); return; }
    const session = sessionRequest.current;
    setPlaylistsLoading(true); setPlaylistsError('');
    try { const lists = await api.playlists(); if (session === sessionRequest.current) setPlaylists(lists); }
    catch (error) { if (session === sessionRequest.current) setPlaylistsError(error instanceof Error ? error.message : '歌单加载失败，请重试'); }
    finally { if (session === sessionRequest.current) setPlaylistsLoading(false); }
  };
  const openPlaylist = async (playlist: Playlist) => {
    const request = ++playlistRequest.current;
    setSelectedPlaylist(playlist); setPlaylistError(''); setPlaylistLoading(false); nav('playlist');
    if (!api || playlist.songs) return;
    setPlaylistLoading(true);
    try { const detail = await api.playlist(playlist.id); if (request === playlistRequest.current) setSelectedPlaylist(detail); }
    catch (error) { if (request === playlistRequest.current) setPlaylistError(error instanceof Error ? error.message : '歌单加载失败'); }
    finally { if (request === playlistRequest.current) setPlaylistLoading(false); }
  };
  const openAlbum = async (album: Album) => {
    const request = ++albumRequest.current;
    setSelectedAlbum(album); setAlbumError(''); setAlbumLoading(false); nav('album');
    if (!api || album.songs?.length) return;
    setAlbumLoading(true);
    try {
      const detail = await api.album(album.id);
      if (request === albumRequest.current) setSelectedAlbum((current) => current?.id === album.id ? detail : current);
    } catch (error) {
      if (request === albumRequest.current) setAlbumError(error instanceof Error ? error.message : '专辑加载失败');
    } finally {
      if (request === albumRequest.current) setAlbumLoading(false);
    }
  };
  const loadLibrarySongs = async (nextPage: number) => {
    const request = ++librarySongRequest.current;
    const session = sessionRequest.current;
    setLibrarySongLoading(true); setLibrarySongError('');
    try {
      const songs = api ? await api.songsPage(nextPage * LIBRARY_PAGE_SIZE, LIBRARY_PAGE_SIZE, albums) : demoSongs.slice(nextPage * LIBRARY_PAGE_SIZE, (nextPage + 1) * LIBRARY_PAGE_SIZE);
      if (request === librarySongRequest.current && session === sessionRequest.current) {
        const hasNextPage = songs.length === LIBRARY_PAGE_SIZE;
        setLibrarySongs(songs); setLibrarySongPage(nextPage); setLibraryHasNext(hasNextPage);
        setLibraryKnownPageCount((count) => hasNextPage ? Math.max(count, nextPage + 2) : nextPage + 1);
      }
    } catch (error) {
      if (request === librarySongRequest.current && session === sessionRequest.current) setLibrarySongError(error instanceof Error ? error.message : '歌曲列表加载失败');
    } finally { if (request === librarySongRequest.current && session === sessionRequest.current) setLibrarySongLoading(false); }
  };
  const refreshRandom = async () => {
    const request = ++randomRequest.current;
    const session = sessionRequest.current;
    setRandomLoading(true); setRandomError('');
    try {
      const songs = api ? await api.randomSongs() : sampleSongs(demoSongs);
      if (request === randomRequest.current && session === sessionRequest.current) setRandomSongs(songs);
    } catch (error) {
      if (request === randomRequest.current && session === sessionRequest.current) {
        setRandomError(error instanceof Error ? error.message : '随机歌曲加载失败');
        // Only fall back to songs from this server, never to unrelated demo tracks.
        if (!randomSongs.length) setRandomSongs(sampleSongs(albums.flatMap((album) => album.songs || [])));
      }
    } finally { if (request === randomRequest.current && session === sessionRequest.current) setRandomLoading(false); }
  };
  const openArtist = async (name: string) => {
    const request = ++artistRequest.current;
    const artistAlbums = albums.filter((album) => album.artist === name);
    setSelectedArtist({ name, albums: artistAlbums, songs: artistAlbums.flatMap((album) => album.songs || []) });
    setArtistError(''); setArtistLoading(!!api && artistAlbums.some((album) => !album.songs)); nav('artist');
    if (!api) return;
    // Limit concurrent detail requests for artists with a large discography.
    const details = [...artistAlbums];
    let cursor = 0;
    let failed = false;
    await Promise.all(Array.from({ length: Math.min(4, details.length) }, async () => {
      while (cursor < details.length && request === artistRequest.current) {
        const index = cursor++;
        if (details[index].songs) continue;
        try { details[index] = await api.album(details[index].id); } catch { failed = true; }
      }
    }));
    if (request !== artistRequest.current) return;
    setSelectedArtist({ name, albums: details, songs: Array.from(new Map(details.flatMap((album) => album.songs || []).map((song) => [song.id, song])).values()) });
    setArtistLoading(false); setArtistError(failed ? '部分专辑歌曲加载失败，重新打开歌手可重试。' : '');
  };
  const playSong = (song: Song, list?: Song[]) => {
    const tracks = (list || selectedAlbum?.songs || [song]).map((item) => ({ ...item, source: mode } as PlayerTrack));
    const index = tracks.findIndex((item) => item.id === song.id);
    setQueue(tracks); setCurrentIndex(index >= 0 ? index : 0);
  };
  const togglePlay = () => {
    const audio = audioRef.current; if (!audio || !currentTrack) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)); else { audio.pause(); setPlaying(false); }
  };
  const next = () => {
    if (!queue.length) return;
    const nextIndex = shuffle ? Math.floor(Math.random() * queue.length) : (currentIndex + 1) % queue.length;
    if (!repeat && !shuffle && currentIndex === queue.length - 1) { setPlaying(false); return; }
    if (nextIndex === currentIndex && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => setPlaying(false)); }
    else setCurrentIndex(nextIndex);
  };
  const previous = () => { if (audioRef.current && audioRef.current.currentTime > 3) audioRef.current.currentTime = 0; else if (queue.length) setCurrentIndex((currentIndex - 1 + queue.length) % queue.length); };

  const primaryNav = [{ id: 'home' as const, label: '主页', icon: Home }, { id: 'search' as const, label: '搜索', icon: Search }];
  const libraryNav = [{ id: 'library' as const, label: '资源库', icon: Library }, { id: 'artists' as const, label: '歌手', icon: Users }, { id: 'albums' as const, label: '专辑', icon: AlbumIcon }, { id: 'playlists' as const, label: '歌单', icon: ListMusic }];
  const currentServerName = mode === 'demo' ? '本地预览' : serverLabel(connectedSettings || settings);
  const nav = (id: typeof page) => {
    const target = id === 'search' ? 'library' : id;
    setNavigation((current) => current.pages[current.index] === target ? current : { pages: [...current.pages.slice(0, current.index + 1), target], index: current.index + 1 });
    setMobileNav(false); setServerMenuOpen(false);
    if (id === 'search') setFocusLibrarySearch(true);
  };
  const moveHistory = (step: number) => { setNavigation((current) => ({ ...current, index: Math.max(0, Math.min(current.pages.length - 1, current.index + step)) })); setMobileNav(false); setServerMenuOpen(false); };
  const openConnectionSettings = () => { setConnectionViewKey((key) => key + 1); nav('settings'); };
  const renderNavItem = ({ id, label, icon: Icon }: typeof primaryNav[number] | typeof libraryNav[number]) => {
    const active = id === 'search' ? page === 'library' && focusLibrarySearch : page === id || (id === 'albums' && page === 'album') || (id === 'artists' && page === 'artist') || (id === 'playlists' && page === 'playlist');
    return <button key={id} className={cn('nav-item', active && 'active')} aria-current={active ? 'page' : undefined} onClick={() => nav(id)}><Icon size={18} /><span>{label}</span></button>;
  };

  return <div className={cn('app-shell', !preferences.showArtists && 'hide-album-artists', !preferences.showDurations && 'hide-song-durations', preferences.accent === 'blue' && 'accent-blue')}>
    <aside className={cn('sidebar', mobileNav && 'mobile-open')}>
      <div className="server-switcher" ref={serverSwitcherRef}>
        <button ref={serverButtonRef} className="server-switcher-button" aria-label={`切换服务器：${currentServerName}`} aria-expanded={serverMenuOpen} aria-controls="server-options" onClick={() => setServerMenuOpen((open) => !open)}><span className={cn('status-dot', isConnected && 'online')} /><span className="server-switcher-copy"><strong>{currentServerName}</strong><small>{isConnected ? 'Navidrome · 已连接' : '空白预览'}</small></span><ChevronDown size={16} /></button>
        {serverMenuOpen && <div className="server-menu" id="server-options" aria-label="服务器选项">
          <p>音乐服务器</p>
          {isConnected && <button className="server-option current" onClick={() => setServerMenuOpen(false)}><span className="status-dot online" /><span>{currentServerName}<small>当前连接</small></span><Check size={15} /></button>}
          <button className={cn('server-option', mode === 'demo' && 'current')} onClick={() => { if (mode !== 'demo') useDemo(); nav('home'); }}><Disc3 size={17} /><span>本地预览<small>未连接服务器，连接后加载音乐</small></span>{mode === 'demo' && <Check size={15} />}</button>
          <button className="server-option server-add" onClick={openConnectionSettings}><Plus size={17} /><span>添加 / 切换服务器</span></button>
          <small className="server-menu-note">当前支持一套服务器连接，切换需重新认证。</small>
        </div>}
      </div>
      <nav className="sidebar-navigation" aria-label="主导航">
        <div className="nav-group">{primaryNav.map(renderNavItem)}</div>
        <div className="nav-group"><p className="nav-group-label">音乐库</p>{libraryNav.map(renderNavItem)}</div>
      </nav>
      <div className="sidebar-footer"><button className={cn('nav-item', page === 'settings' && 'active')} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => nav('settings')}><Settings size={18} /><span>设置</span></button><small>Tenma · 天马音乐空间</small></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="关闭菜单" onClick={() => setMobileNav(false)} />}
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-drag-zone" data-tauri-drag-region aria-hidden="true" />
        <div className="topbar-left">
          <button className="mobile-menu icon-button" aria-label="打开菜单" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
        </div>
        <div className="topbar-brand" aria-label="Tenma">Tenma</div>
        <div className="top-actions"><WindowControls /></div>
      </header>
      <div className="content-scroll">
        {message && <div className={cn('toast', message.type)}>{message.type === 'success' ? '✓' : '!'} {message.text}<button onClick={() => setMessage(null)}><X size={15} /></button></div>}
        <div key={page} className="content-page">
          {page === 'settings' ? <SettingsView key={connectionViewKey} settings={settings} setSettings={setSettings} connected={connectedSettings} password={password} setPassword={setPassword} rememberPassword={rememberPassword} setRememberPassword={setRememberPassword} connect={connect} loading={loading} useDemo={useDemo} disconnect={useDemo} rename={renameServer} preferences={preferences} setPreferences={setPreferences} /> : page === 'playlists' ? <PlaylistsView playlists={playlists} onOpen={openPlaylist} error={playlistsError} onRefresh={refreshPlaylists} loading={playlistsLoading} /> : page === 'playlist' ? <PlaylistDetailView playlist={selectedPlaylist} loading={playlistLoading} error={playlistError} onBack={() => moveHistory(-1)} onPlay={playSong} /> : page === 'album' ? <AlbumDetailView album={selectedAlbum} loading={albumLoading} error={albumError} onBack={() => moveHistory(-1)} onPlay={playSong} /> : page === 'artist' ? <ArtistDetailView artist={selectedArtist} loading={artistLoading} error={artistError} onBack={() => nav('artists')} onOpen={openAlbum} onPlay={playSong} /> : page === 'artists' ? <ArtistsView albums={albums} onOpen={openArtist} /> : page === 'albums' ? <AlbumsView albums={albums} error={albumsError} onOpen={openAlbum} /> : page === 'library' || page === 'search' ? <LibraryView albums={albums} albumsError={albumsError} playlists={playlists} playlistsError={playlistsError} songs={librarySongs} songPage={librarySongPage} songLoading={librarySongLoading} songError={librarySongError} hasNext={libraryHasNext} knownPageCount={libraryKnownPageCount} query={query} onQuery={setQuery} results={searchResults} searchLoading={loading} randomSongs={randomSongs} randomLoading={randomLoading} randomError={randomError} onRefreshRandom={refreshRandom} onArtist={openArtist} onOpen={openAlbum} onPlay={playSong} onPage={loadLibrarySongs} /> : <HomeView albums={recentAlbums.slice(0, 8)} mode={mode} loading={loading} onOpen={openAlbum} onConnect={() => nav('settings')} />}
        </div>
      </div>
    </main>
    <audio ref={audioRef} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setMessage({ type: 'error', text: '播放失败，请检查网络或音频格式。' }); }} onEnded={() => { setPlaying(false); if (preferences.autoNext) next(); }} />
    <Player track={currentTrack} playing={playing} currentTime={currentTime} duration={duration} volume={volume} shuffle={shuffle} repeat={repeat} onToggle={togglePlay} onPrevious={previous} onNext={next} onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} onVolume={setVolume} onShuffle={() => setShuffle(!shuffle)} onRepeat={() => setRepeat(!repeat)} showQueue={showQueue} onQueue={() => setShowQueue(!showQueue)} />
    {showQueue && <section className="queue-panel" aria-label="播放队列"><div className="group-title"><h2>播放队列</h2><button className="icon-button" aria-label="关闭队列" onClick={() => setShowQueue(false)}><X size={18} /></button></div>{queue.length ? queue.map((song, index) => <button key={`${song.id}-${index}`} className={cn('queue-track', index === currentIndex && 'control-active')} onClick={() => { if (index === currentIndex) togglePlay(); else setCurrentIndex(index); }}><span>{song.title}<small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span></button>) : <p>还没有添加歌曲。</p>}</section>}

  </div>;
}

function HomeView({ albums, mode, loading, onOpen, onConnect }: { albums: Album[]; mode: AppMode; loading: boolean; onOpen: (album: Album) => void; onConnect: () => void }) {
  return <section className="home-view">
    <div className="section-heading"><h1>最近添加</h1><span>{albums.length} 张专辑</span></div>
    {mode === 'demo' && <p className="connection-hint">当前是空白预览，连接 Navidrome 后加载你的音乐 <button onClick={onConnect}>连接 Navidrome <ChevronRight size={13} /></button></p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={23} />正在加载…</div> : albums.length ? <div className="album-grid">{albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div> : <EmptyPage title="还没有专辑" description="你的音乐专辑会显示在这里。" icon={<AlbumIcon size={25} />} />}
  </section>;
}

function Pagination({ page, pageCount, onPage, hasNext = page < pageCount - 1 }: { page: number; pageCount: number; onPage: (page: number) => void; hasNext?: boolean }) {
  const safeCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(0, page), safeCount - 1);
  const windowSize = Math.min(5, safeCount);
  const start = safeCount <= 5 ? 0 : safePage <= 2 ? 0 : safePage >= safeCount - 3 ? safeCount - 5 : safePage - 2;
  const visible = Array.from({ length: windowSize }, (_, index) => start + index);
  return <nav className="pagination" aria-label="分页">
    <button className="pagination-button pagination-arrow" aria-label="上一页" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}><ChevronLeft size={16} /><span>上一页</span></button>
    {visible.map((index) => <button key={index} className={cn('pagination-button', index === safePage && 'active')} aria-current={index === safePage ? 'page' : undefined} onClick={() => onPage(index)}>{index + 1}</button>)}
    <button className="pagination-button pagination-arrow" aria-label="下一页" disabled={!hasNext || safePage >= safeCount - 1 && !hasNext} onClick={() => onPage(safePage + 1)}><span>下一页</span><ChevronRight size={16} /></button>
  </nav>;
}

function AlbumsView({ albums, error, onOpen }: { albums: Album[]; error: string; onOpen: (album: Album) => void }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(albums.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="albums-view"><div className="section-heading"><h1>专辑</h1><span>{albums.length} 张专辑</span></div>{error ? <p className="inline-error">完整专辑加载失败：{error}，请重新连接重试。</p> : <p className="library-note">当前音乐库的全部专辑</p>}{albums.length ? <><div className="album-grid">{albums.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title="还没有专辑" description="连接音乐服务后查看你的专辑。" icon={<AlbumIcon size={25} />} />}</section>;
}

function ArtistsView({ albums, onOpen }: { albums: Album[]; onOpen: (name: string) => void }) {
  const artists = Array.from(new Set(albums.map((album) => album.artist).filter(Boolean)));
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(artists.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="artists-view"><div className="section-heading"><h1>歌手</h1><span>{artists.length} 位歌手</span></div><p className="library-note">根据当前已载入的专辑整理</p>{artists.length ? <><div className="artist-grid">{artists.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((artist) => {
    const artistAlbums = albums.filter((album) => album.artist === artist);
    return <button className="artist-item" key={artist} aria-label={`查看歌手 ${artist}`} onClick={() => onOpen(artist)}><Cover src={artistAlbums[0]?.coverArt} alt={artist} className="artist-avatar" /><strong>{artist}</strong><small>{artistAlbums.length} 张专辑</small></button>;
  })}</div><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title="暂无歌手" description="载入专辑后，这里会显示对应的歌手。" icon={<Users size={25} />} />}</section>;
}

function TrackTable({ songs, onPlay }: { songs: Song[]; onPlay: (song: Song, list?: Song[]) => void }) {
  return <div className="library-track-table">
    <div className="library-track-heading" aria-hidden="true"><span>#</span><span>歌曲</span><span className="track-artist">艺人</span><span className="track-album">专辑</span><span className="song-duration">时长</span><span /></div>
    {songs.map((song, index) => <button key={song.id} className="library-track-row" aria-label={`播放 ${song.title}，${song.artist}`} onClick={() => onPlay(song, songs)}>
      <span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="table-song"><Cover src={song.coverArt} alt={song.album} /><span className="song-main"><strong>{song.title}</strong><small>{song.artist}</small></span></span>
      <span className="track-artist">{song.artist}</span><span className="track-album">{song.album}</span><span className="song-duration">{formatTime(song.duration)}</span><Play size={15} />
    </button>)}
  </div>;
}

function RecommendCards({ songs, loading, error, onRefresh, onPlay }: { songs: Song[]; loading: boolean; error: string; onRefresh: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  return <><div className="section-heading"><h2>随便听听</h2><button className="secondary-button" disabled={loading} onClick={onRefresh}><Shuffle size={14} />换一批</button></div>{error && <p className="inline-error">{error}</p>}{loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />正在挑选歌曲…</div> : songs.length ? <div className="recommend-grid">{songs.map((song) => <button className="recommend-card" key={song.id} onClick={() => onPlay(song, songs)}><Cover src={song.coverArt} alt={song.album} /><span className="recommend-copy"><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></span><span className="recommend-play"><Play size={15} fill="currentColor" /></span></button>)}</div> : <EmptyPage title="暂无推荐歌曲" description="点击换一批重试，或搜索想听的音乐。" icon={<Music2 size={25} />} />}</>;
}

function SearchResultsCards({ results, loading, onArtist, onOpen, onPlay }: { results: SearchResults; loading: boolean; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (loading) return <div className="loading-state"><LoaderCircle className="spin" size={25} />正在搜索…</div>;
  return <>{results.songs.length > 0 && <div className="result-group"><div className="group-title"><h2>歌曲</h2><span>{results.songs.length}</span></div><div className="search-result-grid">{results.songs.map((song) => <button className="search-result-card" key={song.id} onClick={() => onPlay(song, results.songs)}><Cover src={song.coverArt} alt={song.album} /><span className="recommend-copy"><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></span><Play size={15} /></button>)}</div></div>}{results.albums.length > 0 && <div className="result-group"><div className="group-title"><h2>专辑</h2><span>{results.albums.length}</span></div><div className="album-grid search-grid">{results.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div></div>}{results.artists.length > 0 && <div className="result-group"><div className="group-title"><h2>歌手</h2><span>{results.artists.length}</span></div><div className="artist-pills">{results.artists.map((artist) => <button key={artist.id} onClick={() => onArtist(artist.name)}><span className="artist-avatar">{artist.name[0]}</span>{artist.name}</button>)}</div></div>}{!results.songs.length && !results.albums.length && !results.artists.length && <EmptyPage title="没有找到结果" description="试试歌曲名、艺人名或专辑名。" icon={<Search size={25} />} />}</>;
}

function LibraryView({ albums, albumsError, playlists, playlistsError, songs, songPage, songLoading, songError, hasNext, knownPageCount, query, onQuery, results, searchLoading, randomSongs, randomLoading, randomError, onRefreshRandom, onArtist, onOpen, onPlay, onPage }: { albums: Album[]; albumsError: string; playlists: Playlist[]; playlistsError: string; songs: Song[]; songPage: number; songLoading: boolean; songError: string; hasNext: boolean; knownPageCount: number; query: string; onQuery: (query: string) => void; results: SearchResults; searchLoading: boolean; randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void; onPage: (page: number) => void }) {
  const songCount = indexedSongCount(albums);
  const hasSongCounts = albums.some((album) => album.songCount !== undefined || album.songs?.length !== undefined);
  const stats = [{ label: '歌曲', count: albumsError || !hasSongCounts ? null : songCount, icon: Music2 }, { label: '专辑', count: albumsError ? null : albums.length, icon: AlbumIcon }, { label: '歌手', count: albumsError ? null : new Set(albums.map((album) => album.artist)).size, icon: Users }, { label: '歌单', count: playlistsError ? null : playlists.length, icon: ListMusic }];
  return <section className="library-view"><div className="page-heading"><h1>资源库</h1><p>搜索、浏览并播放你的音乐收藏。</p></div>
    <div className="library-search"><Search size={21} /><input className="library-search-input" aria-label="搜索歌曲、专辑或歌手" placeholder="搜索歌曲、专辑或歌手…" value={query} onChange={(event) => onQuery(event.target.value)} />{query && <button className="icon-button" aria-label="清空搜索内容" onClick={() => onQuery('')}><X size={18} /></button>}</div>
    <div className="library-stats">{stats.map(({ label, count, icon: Icon }) => <div className="library-stat" key={label}><Icon size={21} /><span>{label}<strong>{count === null ? '—' : count.toLocaleString()}</strong></span></div>)}</div>
    {albumsError && <p className="inline-error">完整专辑加载失败：{albumsError}，请重新连接重试。</p>}{playlistsError && <p className="inline-error">{playlistsError}</p>}
    {query.trim() ? <><div className="section-heading"><h2>搜索结果</h2></div><SearchResultsCards results={results} loading={searchLoading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /></> : <><RecommendCards songs={randomSongs} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} /><div className="section-heading library-songs-heading"><h2>全部歌曲</h2><span>第 {songPage + 1} 页</span></div>{songError && <p className="inline-error">{songError}，推荐歌曲仍可使用。</p>}{songLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />正在加载歌曲…</div> : songs.length ? <TrackTable songs={songs} onPlay={onPlay} /> : <EmptyPage title="暂无歌曲" description="当前服务器没有返回歌曲列表。" icon={<Music2 size={25} />} />}<Pagination page={songPage} pageCount={knownPageCount} hasNext={!songLoading && hasNext} onPage={onPage} /></>}
  </section>;
}

// Kept as a compatibility export for older integrations; the app routes search into LibraryView.
function SearchView({ query, onQuery, results, loading, randomSongs, randomLoading, randomError, onRefreshRandom, onArtist, onOpen, onPlay }: { query: string; onQuery: (query: string) => void; results: SearchResults; loading: boolean; randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  return <section className="search-view"><div className="search-hero"><Search size={21} /><input aria-label="搜索歌曲、专辑、歌手" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索歌曲、专辑或歌手…" /></div>{query.trim() ? <SearchResultsCards results={results} loading={loading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /> : <RecommendCards songs={randomSongs} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} />}</section>;
}

function EmptyPage({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) { return <div className="empty-page"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p></div>; }

function DetailBack({ label = '返回', onBack }: { label?: string; onBack: () => void }) {
  return <button className="detail-back" onClick={onBack}><ChevronLeft size={17} />{label}</button>;
}

function ArtistDetailView({ artist, loading, error, onBack, onOpen, onPlay }: { artist: ArtistDetail | null; loading: boolean; error: string; onBack: () => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!artist) return <section className="detail-page"><DetailBack label="返回歌手列表" onBack={onBack} /></section>;
  return <section className="detail-page artist-detail"><DetailBack label="返回歌手列表" onBack={onBack} />
    <div className="detail-header"><Cover src={artist.albums[0]?.coverArt} alt={artist.name} className="detail-cover artist-avatar" /><div className="detail-content"><p className="eyebrow">歌手</p><h1>{artist.name}</h1><p className="detail-meta">{artist.albums.length} 张专辑 · {loading ? '歌曲加载中…' : `${artist.songs.length} 首歌曲`}</p><button className="primary-button" disabled={loading || !artist.songs.length} onClick={() => onPlay(artist.songs[0], artist.songs)}><Play size={16} fill="currentColor" />播放歌曲</button></div></div>
    <div className="detail-section-heading"><h2>专辑</h2><span>{artist.albums.length} 张</span></div>
    {artist.albums.length ? <div className="album-grid">{artist.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div> : <p className="library-note">当前音乐库暂无该歌手的专辑。</p>}
    <div className="detail-section-heading"><h2>歌曲</h2><span>{artist.songs.length} 首</span></div>
    {error && <p className="inline-error">{error}</p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />加载歌手曲目…</div> : artist.songs.length ? <TrackTable songs={artist.songs} onPlay={onPlay} /> : <EmptyPage title="暂无歌曲" description="可以打开专辑查看详情，或稍后重试。" icon={<Music2 size={25} />} />}
  </section>;
}

function AlbumDetailView({ album, loading, error, onBack, onPlay }: { album: Album | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!album) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title="没有找到专辑" description="这张专辑可能已被移除。" icon={<AlbumIcon size={25} />} /></section>;
  const songs = album.songs || [];
  return <section className="detail-page">
    <DetailBack label="返回专辑列表" onBack={onBack} />
    <div className="detail-header">
      <Cover src={album.coverArt} alt={album.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">专辑</p><h1>{album.name}</h1><p className="detail-meta">{album.artist}{album.year ? ` · ${album.year}` : ''}{album.songCount || songs.length ? ` · ${album.songCount || songs.length} 首歌曲` : ''}</p><button className="primary-button" disabled={loading || !songs.length} onClick={() => songs[0] && onPlay(songs[0], songs)}><Play size={16} fill="currentColor" />播放专辑</button></div>
    </div>
    <div className="detail-section-heading"><h2>歌曲</h2><span>{loading ? '加载中…' : `${songs.length} 首`}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />加载专辑曲目…</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>返回上一页</button></div> : songs.length ? <div className="detail-track-list">{songs.map((song, index) => <button className="detail-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, songs)}><span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span><span className="detail-track-main"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={16} /></button>)}</div> : <EmptyPage title="暂无歌曲" description="这张专辑还没有可播放的歌曲。" icon={<Music2 size={25} />} />}
  </section>;
}

function PlaylistDetailView({ playlist, loading, error, onBack, onPlay }: { playlist: Playlist | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!playlist) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title="没有找到歌单" description="这个歌单可能已被移除。" icon={<ListMusic size={25} />} /></section>;
  const songs = playlist.songs || [];
  return <section className="detail-page">
    <DetailBack label="返回歌单列表" onBack={onBack} />
    <div className="detail-header">
      <Cover src={playlist.coverArt} alt={playlist.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">歌单 · {playlist.public ? '公开' : '私人'}</p><h1>{playlist.name}</h1><p className="detail-meta">{playlist.owner || '当前账号'} · {playlist.songCount || songs.length} 首歌曲 · {formatTime(playlist.duration)}</p>{playlist.comment && <p className="detail-description">{playlist.comment}</p>}<button className="primary-button" disabled={loading || !songs.length} onClick={() => songs[0] && onPlay(songs[0], songs)}><Play size={16} fill="currentColor" />播放歌单</button></div>
    </div>
    <div className="detail-section-heading"><h2>歌曲</h2><span>{loading ? '加载中…' : `${songs.length} 首`}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />加载歌单曲目…</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>返回上一页</button></div> : songs.length ? <div className="detail-track-list">{songs.map((song, index) => <button className="detail-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, songs)}><span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span><span className="detail-track-main"><strong>{song.title}</strong><small>{song.artist}{song.album ? ` · ${song.album}` : ''}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={16} /></button>)}</div> : <EmptyPage title="暂无歌曲" description="这个歌单还没有可播放的歌曲。" icon={<ListMusic size={25} />} />}
  </section>;
}

function Player({ track, playing, currentTime, duration, volume, shuffle, repeat, onToggle, onPrevious, onNext, onSeek, onVolume, onShuffle, onRepeat, showQueue, onQueue }: { track?: PlayerTrack; playing: boolean; currentTime: number; duration: number; volume: number; shuffle: boolean; repeat: boolean; onToggle: () => void; onPrevious: () => void; onNext: () => void; onSeek: (value: number) => void; onVolume: (value: number) => void; onShuffle: () => void; onRepeat: () => void; showQueue: boolean; onQueue: () => void }) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  return <footer className="player">
    <div className="now-playing">{track ? <Cover src={track.coverArt} alt={track.album} className="player-art" /> : <div className="player-art player-placeholder"><Music2 size={22} /></div>}<div className="track-label"><strong>{track?.title || '未在播放'}</strong><span>{track?.artist || '选择一首喜欢的歌'}</span></div></div>
    <div className="player-center"><div className="player-controls">
      <button aria-label="随机播放" aria-pressed={shuffle} className={cn(shuffle && 'control-active')} onClick={onShuffle}><Shuffle size={17} /></button>
      <button aria-label="上一首" disabled={!track} onClick={onPrevious}><SkipBack size={19} fill="currentColor" /></button>
      <button className="play-button" aria-label={playing ? '暂停' : '播放'} onClick={onToggle} disabled={!track}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <button aria-label="下一首" disabled={!track} onClick={onNext}><SkipForward size={19} fill="currentColor" /></button>
      <button aria-label="循环播放" aria-pressed={repeat} className={cn(repeat && 'control-active')} onClick={onRepeat}><Repeat size={17} /></button>
    </div><div className="progress-row"><span>{formatTime(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={total} disabled={!track || !total} step="1" value={Math.min(currentTime, total)} onChange={(e) => onSeek(Number(e.target.value))} /><span>{formatTime(total)}</span></div></div>
    <div className="player-extra"><Volume2 size={18} /><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => onVolume(Number(e.target.value))} /><button aria-label="播放队列" aria-pressed={showQueue} className={cn(showQueue && 'control-active')} onClick={onQueue}><ListMusic size={20} /></button></div>
  </footer>;
}

export default App;
