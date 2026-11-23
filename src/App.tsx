import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTauri, invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Album as AlbumIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Dices, Disc3, Home, Library, ListMusic, LoaderCircle, Menu, Minus, MoreVertical, Music2, Pause, Play, Plus, Repeat, Search, Server, Settings, Shuffle, SkipBack, SkipForward, Square, Users, Volume2, VolumeX, X } from 'lucide-react';
import { NavidromeApi } from './api';
import { emptyLocalAlbums, emptyLocalPlaylists, emptyLocalSongs, localAlbumsFromSongs, pickLocalLibraryFolder, scanLocalLibrary, searchLocalLibrary } from './localLibrary';
import type { Album, AppMode, ConnectionSettings, Playlist, PlayerTrack, SearchResults, Song } from './types';
import { cn, coverFallback, formatTime } from './utils';
import { perceivedVolume, fadeAudio } from './audioFades';
import { queueAroundTrack, shuffledItems } from './playback';
import { albumForSong, groupArtists } from './musicNavigation';
import { BUILTIN_WALLPAPERS, DEFAULT_WALLPAPER_BLUR, DEFAULT_WALLPAPER_OPACITY, isWallpaperId } from './wallpapers';
import type { WallpaperId } from './wallpapers';

import { SettingsView, loadPreferences, serverLabel } from './SettingsView';
import type { Page } from './SettingsView';
import { PlaylistsView } from './PlaylistsView';
import { NowPlayingView } from './NowPlayingView';
import { BalancedGrid } from './BalancedGrid';
import { TrackContextMenu } from './TrackContextMenu';
import { PlaylistEditor } from './PlaylistEditor';
import { I18nContext, errorContent, loadLanguage, resolveMessage, saveLanguage, translate, useI18n } from './i18n';
import type { Language, MessageContent, TranslationKey } from './i18n';

const LIBRARY_PAGE_SIZE = 25;
const GRID_PAGE_SIZE = 25;
const SUCCESS_TOAST_DURATION_MS = 4000;
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const storageGet = (key: string) => { try { return globalThis.localStorage?.getItem(key) || ''; } catch { return ''; } };
const storageSet = (key: string, value: string) => { try { globalThis.localStorage?.setItem(key, value); } catch { /* Optional browser storage must not block the app. */ } };
const storageRemove = (key: string) => { try { globalThis.localStorage?.removeItem(key); } catch { /* Optional browser storage must not block the app. */ } };

const reconnectPausedKey = 'tenma.remoteReconnectPaused';
const storedSettings = (): ConnectionSettings => ({
  serverName: storageGet('northstar.serverName'),
  server: storageGet('northstar.server'),
  username: storageGet('northstar.username')
});

function Cover({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed || !src ? <div className={cn('cover-fallback', className)} style={{ background: coverFallback(alt) }}><Disc3 size={30} /></div> : <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function AlbumCard({ album, onOpen, onArtist }: { album: Album; onOpen: (album: Album) => void; onArtist?: (name: string, artistId?: string) => void }) {
  const { t } = useI18n();
  return <div className="album-card" onClick={() => onOpen(album)}>
    <button type="button" className="album-card-open" onClick={(event) => { event.stopPropagation(); onOpen(album); }}>
      <span className="album-art-wrap"><Cover src={album.coverArt} alt={album.name} className="album-art" /><span className="play-overlay"><Play fill="currentColor" size={18} /></span></span>
      <span className="album-name">{album.name}</span>
    </button>
    <span className="album-artist"><MetadataLink label={t('artists.view', { name: album.artist })} onOpen={album.artist.trim() && onArtist ? () => onArtist(album.artist, album.artistId) : undefined}>{album.artist}</MetadataLink></span>
  </div>;
}

function WindowControls({ onClose }: { onClose: () => Promise<void> }) {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { setDesktop(isTauri()); }, []);
  if (!desktop) return null;
  const currentWindow = getCurrentWindow();
  const runWindowAction = (event: React.MouseEvent<HTMLButtonElement>, action: () => Promise<void>) => {
    event.preventDefault();
    event.stopPropagation();
    void action().catch((error: unknown) => console.error('Window control failed', error));
  };
  return <div className="window-controls" aria-label={t('window.controls')} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" aria-label={t('window.minimize')} onClick={(event) => runWindowAction(event, () => currentWindow.minimize())}><Minus size={14} /></button>
    <button type="button" aria-label={t('window.maximize')} onClick={(event) => runWindowAction(event, () => currentWindow.toggleMaximize())}><Square size={12} /></button>
    <button type="button" className="window-close" aria-label={t('window.close')} onClick={(event) => runWindowAction(event, onClose)}><X size={15} /></button>
  </div>;
}

function sampleSongs(songs: Song[], size = 9) {
  return shuffledItems(songs).slice(0, size);
}

function indexedSongCount(albums: Album[]) {
  return albums.reduce((total, album) => total + (album.songCount || album.songs?.length || 0), 0);
}

type ArtistDetail = { name: string; id?: string; albums: Album[]; songs: Song[] };
type DetailSnapshot = { album: Album | null; albumLoading: boolean; albumError: MessageContent; playlist: Playlist | null; playlistLoading: boolean; playlistError: MessageContent; artist: ArtistDetail | null; artistLoading: boolean; artistError: MessageContent };
type AvailableUpdate = { version: string; body?: string; downloadAndInstall: (onEvent: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>; close: () => Promise<void> };

function App() {
  const [language, setLanguageState] = useState<Language>(loadLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    if (isTauri()) void emit('tenma-language', language).catch((error: unknown) => console.error('Failed to update the tray language', error));
  }, [language]);
  const setLanguage = (next: Language) => { setLanguageState(next); saveLanguage(next); };
  return <I18nContext.Provider value={{ language, setLanguage, t: (key, values) => translate(language, key, values) }}><AppContent /></I18nContext.Provider>;
}

function AppContent() {
  const { t } = useI18n();
  const [mode, setMode] = useState<AppMode>('local');
  const [localFolder, setLocalFolder] = useState(() => storageGet('tenma.localLibraryPath'));
  const [backgroundImage, setBackgroundImage] = useState(() => storageGet('tenma.backgroundImage'));
  const chooseBackground = async () => {
    if (!isTauri()) return;
    try {
      const path = await invoke<string | null>('pick_background_image');
      if (path) { storageSet('tenma.backgroundImage', path); setBackgroundImage(path); changeWallpaper('custom'); }
    } catch { /* Optional background selection must not break the app. */ }
  };
  const [wallpaper, setWallpaperState] = useState<WallpaperId>(() => { const v = storageGet('tenma.wallpaper'); return isWallpaperId(v) ? v : (storageGet('tenma.backgroundImage') ? 'custom' : 'none'); });
  const readNumber = (key: string, fallback: number) => { const raw = storageGet(key); const n = Number(raw); return raw !== '' && Number.isFinite(n) ? n : fallback; };
  const [wallpaperOpacity, setWallpaperOpacityState] = useState(() => readNumber('tenma.wallpaperOpacity', DEFAULT_WALLPAPER_OPACITY));
  const [wallpaperBlur, setWallpaperBlurState] = useState(() => readNumber('tenma.wallpaperBlur', DEFAULT_WALLPAPER_BLUR));
  const changeWallpaper = (id: WallpaperId) => { storageSet('tenma.wallpaper', id); setWallpaperState(id); };
  const changeWallpaperOpacity = (v: number) => { storageSet('tenma.wallpaperOpacity', String(v)); setWallpaperOpacityState(v); };
  const changeWallpaperBlur = (v: number) => { storageSet('tenma.wallpaperBlur', String(v)); setWallpaperBlurState(v); };
  const resetWallpaper = () => { changeWallpaperOpacity(DEFAULT_WALLPAPER_OPACITY); changeWallpaperBlur(DEFAULT_WALLPAPER_BLUR); };
  const clearBackground = () => { storageSet('tenma.backgroundImage', ''); setBackgroundImage(''); if (wallpaper === 'custom') changeWallpaper('none'); };
  const [localSongs, setLocalSongs] = useState<Song[]>(emptyLocalSongs);
  const [localLoading, setLocalLoading] = useState(false);
  const localRequest = useRef(0);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [navigation, setNavigation] = useState<{ pages: Page[]; index: number }>(() => ({ pages: ['home'], index: 0 }));
  const [connectedSettings, setConnectedSettings] = useState<ConnectionSettings | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>(emptyLocalPlaylists);
  const [playlistsError, setPlaylistsError] = useState<MessageContent>('');
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistSongAdding, setPlaylistSongAdding] = useState('');
  const [playlistSongRemoving, setPlaylistSongRemoving] = useState('');
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<MessageContent>('');
  const playlistRequest = useRef(0);
  const sessionRequest = useRef(0);
  const page = navigation.pages[navigation.index];
  const detailHistory = useRef(new Map<number, DetailSnapshot>());
  const historyScroll = useRef(new Map<number, number>());
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useBrowserLayoutEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = historyScroll.current.get(navigation.index) || 0;
  }, [navigation.index]);
  const [showQueue, setShowQueue] = useState(false);
  const [queueClosing, setQueueClosing] = useState(false);
  const queuePanelRef = useRef<HTMLElement>(null);
  const closeQueue = () => {
    if (!showQueue || queueClosing) return;
    setQueueClosing(true);
    window.setTimeout(() => { setShowQueue(false); setQueueClosing(false); }, 180);
  };
  const toggleQueue = () => { if (showQueue) closeQueue(); else setShowQueue(true); };
  // Clicking anywhere outside the queue panel closes it, player bar included.
  useEffect(() => {
    if (!showQueue) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (queuePanelRef.current?.contains(target)) return;
      closeQueue();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [showQueue, queueClosing]);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [nowPlayingClosing, setNowPlayingClosing] = useState(false);
  const closeNowPlaying = () => {
    if (nowPlayingClosing) return;
    setNowPlayingClosing(true);
    window.setTimeout(() => { setNowPlayingOpen(false); setNowPlayingClosing(false); }, 200);
  };
  const [albums, setAlbums] = useState<Album[]>(emptyLocalAlbums);
  const [albumsError, setAlbumsError] = useState<MessageContent>('');
  const [randomSongs, setRandomSongs] = useState<Song[]>(() => sampleSongs(emptyLocalSongs));
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomError, setRandomError] = useState<MessageContent>('');
  const randomRequest = useRef(0);
  const [selectedArtist, setSelectedArtist] = useState<ArtistDetail | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistError, setArtistError] = useState<MessageContent>('');
  const artistRequest = useRef(0);
  const [api, setApi] = useState<NavidromeApi | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumError, setAlbumError] = useState<MessageContent>('');
  const albumRequest = useRef(0);
  const [query, setQuery] = useState('');
  const [focusLibrarySearch, setFocusLibrarySearch] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults>({ songs: [], albums: [], artists: [] });
  const [librarySongs, setLibrarySongs] = useState<Song[]>(emptyLocalSongs);
  const [librarySongPage, setLibrarySongPage] = useState(0);
  const [libraryKnownPageCount, setLibraryKnownPageCount] = useState(1);
  const [librarySongLoading, setLibrarySongLoading] = useState(false);
  const [librarySongError, setLibrarySongError] = useState<MessageContent>('');
  const [libraryHasNext, setLibraryHasNext] = useState(false);
  const librarySongRequest = useRef(0);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: MessageContent } | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'downloading' | 'error'>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<MessageContent>('');
  const [updateMessage, setUpdateMessage] = useState<TranslationKey | ''>('');
  const [settings, setSettings] = useState(storedSettings);
  const [rememberPassword, setRememberPasswordState] = useState(() => storageGet('northstar.rememberPassword') === 'true');
  const [password, setPassword] = useState(() => storageGet('northstar.rememberPassword') === 'true' ? storageGet('northstar.password') : '');
  // The switcher restores a verified login, never the partially edited form.
  const lastLogin = useRef({ settings, password });
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [playlistContextMenu, setPlaylistContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const playlistsRefreshRequest = useRef(0);
  const [connectionViewKey, setConnectionViewKey] = useState(0);
  const serverSwitcherRef = useRef<HTMLDivElement>(null);
  const serverButtonRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const originalQueue = useRef<PlayerTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => loadPreferences().defaultVolume);
  const [muted, setMuted] = useState(false);
  const lastVolume = useRef(volume || 0.78);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : undefined;

  useEffect(() => {
    setEditingPlaylist(null); setCreatePlaylistOpen(false); setCreatingPlaylist(false); setPlaylistContextMenu(null);
  }, [api]);

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

  useEffect(() => {
    if (!playlistContextMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.playlist-context-menu')) setPlaylistContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlaylistContextMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [playlistContextMenu]);

  const requestWindowClose = async (choice?: 'background' | 'quit') => {
    const currentWindow = getCurrentWindow();
    const behavior = choice || storageGet('tenma.closeBehavior');
    if (behavior === 'background') { await currentWindow.hide(); return; }
    if (behavior === 'quit') { await currentWindow.destroy(); return; }
    setRememberCloseChoice(false);
    setClosePromptOpen(true);
  };

  useEffect(() => {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await requestWindowClose();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error: unknown) => console.error('Failed to register the close request listener', error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const resolveCloseChoice = async (choice: 'background' | 'quit') => {
    if (rememberCloseChoice) storageSet('tenma.closeBehavior', choice);
    setClosePromptOpen(false);
    await requestWindowClose(choice);
  };

  useEffect(() => { storageSet('northstar.preferences', JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => {
    if (message?.type !== 'success') return;
    const timer = window.setTimeout(() => setMessage(null), SUCCESS_TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => { setVolume(preferences.defaultVolume); lastVolume.current = preferences.defaultVolume; setMuted(false); }, [preferences.defaultVolume]);

  const changeVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    if (next > 0) lastVolume.current = next;
    setMuted(next === 0);
    setVolume(next);
  };
  const toggleMute = () => {
    if (muted || volume === 0) { const restored = lastVolume.current || 0.3; setMuted(false); setVolume(restored); }
    else { lastVolume.current = volume; setMuted(true); setVolume(0); }
  };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let update: AvailableUpdate | null = null;
    setUpdateStatus('checking'); setUpdateMessage('');
    import('@tauri-apps/plugin-updater').then(({ check }) => check({ timeout: 15000 })).then((result) => {
      if (cancelled) { if (result) void result.close(); return; }
      if (result) { update = result as AvailableUpdate; setAvailableUpdate(update); setUpdateMessage(''); }
      else setUpdateMessage('update.latest');
      setUpdateStatus('idle');
    }).catch((error: unknown) => {
      if (!cancelled) { setUpdateStatus('error'); setUpdateError(errorContent(error, 'update.failedCheck')); setUpdateMessage(''); }
    });
    return () => { cancelled = true; if (update) void update.close(); };
  }, []);

  const installUpdate = async () => {
    if (!availableUpdate || updateStatus === 'downloading') return;
    setUpdateStatus('downloading'); setUpdateProgress(0); setUpdateError('');
    let downloaded = 0;
    let total = 0;
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') { downloaded = 0; total = event.data?.contentLength || 0; setUpdateProgress(0); }
        if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength || 0;
          setUpdateProgress(total > 0 ? Math.min(99, Math.round(downloaded / total * 100)) : 0);
        }
        if (event.event === 'Finished') setUpdateProgress(100);
      });
    } catch (error) {
      setUpdateStatus('error'); setUpdateError(errorContent(error, 'update.failedDownload'));
    }
  };

  const setRememberPassword = (value: boolean) => {
    setRememberPasswordState(value);
    storageSet('northstar.rememberPassword', String(value));
    if (!value) storageRemove('northstar.password');
    else if (lastLogin.current.password) storageSet('northstar.password', lastLogin.current.password);
  };

  useEffect(() => {
    if (!query.trim()) { setSearchResults({ songs: [], albums: [], artists: [] }); setLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try { const results = api ? await api.search(query.trim()) : searchLocalLibrary(localSongs, query.trim()); if (!cancelled) setSearchResults(results); }
      catch (error) { if (!cancelled) setMessage({ type: 'error', text: errorContent(error, 'search.failed') }); }
      finally { if (!cancelled) setLoading(false); }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, localSongs, query]);

  useEffect(() => {
    if (!focusLibrarySearch || page !== 'library') return;
    const timer = window.setTimeout(() => document.querySelector<HTMLInputElement>('.library-search-input')?.focus(), 0);
    setFocusLibrarySearch(false);
    return () => window.clearTimeout(timer);
  }, [focusLibrarySearch, page]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    let cancelled = false;
    fadeAudio(audio, 0, 150, () => {
      if (cancelled) return;
      setCurrentTime(0); setDuration(0);
      audio.src = currentTrack.streamUrl || '';
      audio.volume = perceivedVolume(volume);
      audio.load();
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    });
    return () => { cancelled = true; };
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    fadeAudio(audio, perceivedVolume(volume), 120);
  }, [volume]);

  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    void establishConnection(settings, password);
  };
  const restoreRemoteConnection = () => {
    const login = lastLogin.current;
    if (mode === 'server' || connecting) return;
    if (!login.password) { openConnectionSettings(); return; }
    void establishConnection(login.settings, login.password);
  };
  useEffect(() => {
    const login = lastLogin.current;
    if (storageGet(reconnectPausedKey) || !login.settings.server || !login.settings.username || !login.password) return;
    const timer = window.setTimeout(() => { void establishConnection(login.settings, login.password); }, 0);
    return () => { window.clearTimeout(timer); sessionRequest.current++; };
  }, []);
  const cancelPendingConnection = () => {
    if (connecting) { sessionRequest.current++; setConnecting(false); }
  };
  const editConnection = (next: ConnectionSettings) => {
    cancelPendingConnection();
    if (next.server !== settings.server || next.username !== settings.username) setPassword('');
    setSettings(next);
  };
  const establishConnection = async (credentials: ConnectionSettings, secret: string) => {
    setConnecting(true); setMessage(null);
    const session = ++sessionRequest.current;
    localRequest.current++; setLocalLoading(false);
    const nextApi = new NavidromeApi(credentials, secret);
    try {
      await nextApi.ping();
      if (session !== sessionRequest.current) return;
      const [all, lists, random] = await Promise.all([
        nextApi.allAlbums().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Album[], error: errorContent(error, 'error.loadAllAlbums') })),
        nextApi.playlists().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Playlist[], error: errorContent(error, 'error.loadPlaylists') })),
        nextApi.randomSongs(9).then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: errorContent(error, 'error.loadRandomSongs') }))
      ]);
      if (session !== sessionRequest.current) return;
      if (all.value.length) nextApi.setAlbumIndex(all.value);
      const songs = await nextApi.songsPage(0, LIBRARY_PAGE_SIZE, all.value).then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: errorContent(error, 'error.songListUnavailable') }));
      if (session !== sessionRequest.current) return;
      const saved = { ...credentials, server: nextApi.base, serverName: serverLabel(credentials) };
      playlistRequest.current++; albumRequest.current++; artistRequest.current++; randomRequest.current++; setPlaylistsLoading(false); setRandomLoading(false);
      audioRef.current?.pause(); originalQueue.current = []; setQueue([]); setCurrentIndex(-1); setCurrentTime(0); setDuration(0);
      setSelectedAlbum(null); setSelectedPlaylist(null); setSelectedArtist(null); setSearchResults({ songs: [], albums: [], artists: [] });
      resetDetailHistory();
      setApi(nextApi); setMode('server'); setAlbums(all.value); setAlbumsError(all.error);
      const indexedSongs = indexedSongCount(all.value);
      const estimatedPages = indexedSongs > 0 ? Math.max(1, Math.ceil(indexedSongs / LIBRARY_PAGE_SIZE)) : 1;
      const initialPageCount = songs.value.length === LIBRARY_PAGE_SIZE ? Math.max(2, estimatedPages) : 1;
      setLibrarySongs(songs.value); setLibrarySongPage(0); setLibraryKnownPageCount(initialPageCount); setLibraryHasNext(songs.value.length === LIBRARY_PAGE_SIZE); setLibrarySongError(songs.error);
      setRandomSongs(random.value); setRandomError(random.error); setPlaylists(lists.value); setPlaylistsError(lists.error ? { key: 'error.playlistsRefresh', values: { error: lists.error } } : '');
      // Keep the password in memory for this session even when local saving is
      // disabled, so enabling the toggle after a successful connection works.
      lastLogin.current = { settings: saved, password: secret };
      setConnectedSettings(saved); setSettings(saved); setPassword(secret);
      storageRemove(reconnectPausedKey);
      storageSet('northstar.server', saved.server); storageSet('northstar.username', saved.username); storageSet('northstar.serverName', saved.serverName);
      storageSet('northstar.rememberPassword', String(rememberPassword));
      if (rememberPassword) storageSet('northstar.password', secret); else storageRemove('northstar.password');
      const namedError = (label: TranslationKey, error: MessageContent): MessageContent => ({ key: 'error.named', values: { label: { key: label }, error } });
      const errors = [
        all.error && namedError('error.allAlbumsLabel', all.error),
        lists.error && namedError('error.playlistsLabel', lists.error),
        random.error && namedError('error.recommendationsLabel', random.error),
        songs.error && namedError('error.songsLabel', songs.error)
      ].filter((value): value is MessageContent => value !== '');
      setMessage({ type: errors.length ? 'error' : 'success', text: errors.length
        ? { key: 'error.connectedWithErrors', values: { name: saved.serverName, errors } }
        : { key: 'error.connected', values: { name: saved.serverName } } });
    } catch (error) { if (session === sessionRequest.current) setMessage({ type: 'error', text: errorContent(error, 'error.connection') }); }
    finally { if (session === sessionRequest.current) setConnecting(false); }
  };

  const applyLocalSongs = (songs: Song[]) => {
    const allAlbums = localAlbumsFromSongs(songs);
    const pageCount = Math.max(1, Math.ceil(songs.length / LIBRARY_PAGE_SIZE));
    setAlbums(allAlbums); setAlbumsError('');
    setLibrarySongs(songs.slice(0, LIBRARY_PAGE_SIZE)); setLibrarySongPage(0); setLibraryKnownPageCount(pageCount); setLibraryHasNext(pageCount > 1); setLibrarySongError('');
    setRandomSongs(sampleSongs(songs)); setRandomError(''); setRandomLoading(false); setPlaylists(emptyLocalPlaylists); setPlaylistsError(''); setPlaylistsLoading(false);
  };
  // Switch the browsing source to the local folder while keeping the remote session
  // and current playback alive; "Disconnect" performs the full teardown instead.
  const useLocalMode = (notify = true) => {
    sessionRequest.current++; playlistRequest.current++; albumRequest.current++; artistRequest.current++; randomRequest.current++;
    storageSet(reconnectPausedKey, '1');
    setConnecting(false); setLoading(false); setLocalLoading(false);
    setMode('local'); setApi(null); applyLocalSongs(localSongs);
    setSelectedAlbum(null); setSelectedPlaylist(null); setSelectedArtist(null); setQuery('');
    resetDetailHistory();
    if (notify) setMessage({ type: 'success', text: { key: 'message.localMode' } });
  };
  const disconnectRemote = () => {
    sessionRequest.current++; playlistRequest.current++; albumRequest.current++; artistRequest.current++; randomRequest.current++;
    audioRef.current?.pause(); if (audioRef.current) { audioRef.current.removeAttribute('src'); audioRef.current.load(); }
    originalQueue.current = [];
    storageSet(reconnectPausedKey, '1');
    setPlaying(false); setConnecting(false); setLoading(false); setQueue([]); setCurrentIndex(-1); setCurrentTime(0); setDuration(0); setShowQueue(false);
    setMode('local'); setApi(null); applyLocalSongs(localSongs);
    setConnectedSettings(null); setSelectedAlbum(null); setSelectedPlaylist(null); setSelectedArtist(null); setQuery('');
    resetDetailHistory();
    if (!rememberPassword) lastLogin.current.password = '';
    setSettings(lastLogin.current.settings); setPassword(lastLogin.current.password);
    setMessage({ type: 'success', text: { key: 'message.disconnected' } });
  };
  const loadLocalLibrary = async (folder: string, notify = false) => {
    if (!folder || !isTauri()) return;
    const request = ++localRequest.current;
    const session = sessionRequest.current;
    setLocalLoading(true);
    try {
      const result = await scanLocalLibrary(folder);
      if (request !== localRequest.current || session !== sessionRequest.current) return;
      setLocalFolder(result.folder); setLocalSongs(result.songs); storageSet('tenma.localLibraryPath', result.folder);
      applyLocalSongs(result.songs);
      if (notify) setMessage({ type: 'success', text: { key: 'message.localLoaded', values: { count: result.songs.length } } });
    } catch (error) {
      if (request === localRequest.current && session === sessionRequest.current) setMessage({ type: 'error', text: errorContent(error, 'error.localLibrary') });
    } finally { if (request === localRequest.current) setLocalLoading(false); }
  };
  const chooseLocalFolder = async () => {
    if (!isTauri()) { setMessage({ type: 'error', text: { key: 'error.localUnavailableWeb' } }); return; }
    try {
      const folder = await pickLocalLibraryFolder(t('local.chooseDialogTitle'));
      if (!folder) return;
      useLocalMode(false);
      await loadLocalLibrary(folder, true);
    } catch (error) { setMessage({ type: 'error', text: errorContent(error, 'error.localLibrary') }); }
  };
  useEffect(() => { if (localFolder && isTauri()) void loadLocalLibrary(localFolder); }, []);
  const renameServer = (name: string) => {
    setConnectedSettings((current) => current ? { ...current, serverName: name } : null);
    lastLogin.current.settings = { ...lastLogin.current.settings, serverName: name };
    setSettings((current) => ({ ...current, serverName: name }));
    storageSet('northstar.serverName', name);
  };
  const createPlaylist = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newPlaylistName.trim();
    const activeApi = api;
    if (!activeApi || !name || creatingPlaylist) return;
    const session = sessionRequest.current;
    setCreatingPlaylist(true);
    try {
      await activeApi.createPlaylist(name);
      if (session !== sessionRequest.current || activeApi !== api) return;
      setNewPlaylistName(''); setCreatePlaylistOpen(false);
      setMessage({ type: 'success', text: { key: 'message.playlistCreated', values: { name } } });
      void refreshPlaylists();
    } catch (error) {
      if (session === sessionRequest.current) setMessage({ type: 'error', text: errorContent(error, 'error.createPlaylist') });
    } finally { if (session === sessionRequest.current) setCreatingPlaylist(false); }
  };
  const openPlaylistCreation = () => {
    setPlaylistContextMenu(null);
    if (!api) { setMessage({ type: 'info', text: { key: 'playlists.connectToCreate' } }); return; }
    setNewPlaylistName(''); setCreatePlaylistOpen(true);
  };
  const openPlaylistContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setPlaylistContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 80)) });
  };
  const renamePlaylist = async (playlist: Playlist, name: string) => {
    if (!api) return;
    const session = sessionRequest.current;
    await api.renamePlaylist(playlist.id, name);
    if (session !== sessionRequest.current) return;
    playlistsRefreshRequest.current++; setPlaylistsLoading(false);
    const renamed = (item: Playlist) => item.id === playlist.id ? { ...item, name } : item;
    setPlaylists((current) => current.map(renamed));
    setSelectedPlaylist((current) => current ? renamed(current) : current);
    for (const snapshot of detailHistory.current.values()) if (snapshot.playlist) snapshot.playlist = renamed(snapshot.playlist);
    setEditingPlaylist(null);
    setMessage({ type: 'success', text: { key: 'message.playlistRenamed', values: { name } } });
  };
  const deletePlaylist = async (playlist: Playlist) => {
    if (!api) return;
    const session = sessionRequest.current;
    await api.deletePlaylist(playlist.id);
    if (session !== sessionRequest.current) return;
    playlistsRefreshRequest.current++; playlistRequest.current++; setPlaylistsLoading(false);
    setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
    setSelectedPlaylist(null); setPlaylistLoading(false); setPlaylistError('');
    const removedPages = new Set<number>();
    for (const [index, snapshot] of detailHistory.current) {
      if (snapshot.playlist?.id !== playlist.id) continue;
      snapshot.playlist = null;
      if (navigation.pages[index] === 'playlist') removedPages.add(index);
    }
    if (page === 'playlist') removedPages.add(navigation.index);
    setEditingPlaylist(null);
    setNavigation((current) => ({ ...current, pages: current.pages.map((entry, index) => removedPages.has(index) ? 'playlists' : entry) }));
    setMessage({ type: 'success', text: { key: 'message.playlistDeleted', values: { name: playlist.name } } });
  };
  const refreshPlaylists = async () => {
    if (!api) { setPlaylists(emptyLocalPlaylists); return; }
    const session = sessionRequest.current;
    const request = ++playlistsRefreshRequest.current;
    setPlaylistsLoading(true); setPlaylistsError('');
    try { const lists = await api.playlists(); if (session === sessionRequest.current && request === playlistsRefreshRequest.current) setPlaylists(lists); }
    catch (error) { if (session === sessionRequest.current && request === playlistsRefreshRequest.current) setPlaylistsError(errorContent(error, 'error.loadPlaylistsRetry')); }
    finally { if (session === sessionRequest.current && request === playlistsRefreshRequest.current) setPlaylistsLoading(false); }
  };
  const openPlaylist = async (playlist: Playlist, pushHistory = true) => {
    artistRequest.current++; albumRequest.current++;
    const request = ++playlistRequest.current;
    if (pushHistory) nav('playlist', true);
    setSelectedPlaylist(playlist); setPlaylistError(''); setPlaylistLoading(false);
    if (!api || playlist.songs) return;
    setPlaylistLoading(true);
    try { const detail = await api.playlist(playlist.id); if (request === playlistRequest.current) setSelectedPlaylist(detail); }
    catch (error) { if (request === playlistRequest.current) setPlaylistError(errorContent(error, 'error.loadPlaylist')); }
    finally { if (request === playlistRequest.current) setPlaylistLoading(false); }
  };
  const openAlbum = async (album: Album, pushHistory = true) => {
    artistRequest.current++; playlistRequest.current++;
    const request = ++albumRequest.current;
    const displayedAlbum = !api ? albums.find((item) => item.name === album.name && item.artist === album.artist) || album : album;
    if (pushHistory) nav('album', true);
    setSelectedAlbum(displayedAlbum); setAlbumError(''); setAlbumLoading(false);
    if (!api || displayedAlbum.songs?.length) return;
    setAlbumLoading(true);
    try {
      const detail = await api.album(album.id);
      if (request === albumRequest.current) setSelectedAlbum((current) => current?.id === album.id ? detail : current);
    } catch (error) {
      if (request === albumRequest.current) setAlbumError(errorContent(error, 'error.loadAlbum'));
    } finally {
      if (request === albumRequest.current) setAlbumLoading(false);
    }
  };
  const removeSongFromPlaylist = async (playlist: Playlist, song: Song) => {
    if (!api || playlistSongRemoving) return;
    const activeApi = api;
    const session = sessionRequest.current;
    setPlaylistSongRemoving(song.id);
    try {
      await activeApi.removeFromPlaylist(playlist.id, song.id);
      if (session !== sessionRequest.current || activeApi !== api) return;
      const update = (current: Playlist | null) => current?.id !== playlist.id ? current : { ...current, songs: (current.songs || []).filter((item) => item.id !== song.id), songCount: Math.max(0, current.songCount - 1), duration: Math.max(0, current.duration - (song.duration || 0)) };
      setSelectedPlaylist(update);
      for (const snapshot of detailHistory.current.values()) snapshot.playlist = update(snapshot.playlist);
      setPlaylists((current) => current.map((item) => item.id === playlist.id ? { ...item, songCount: Math.max(0, item.songCount - 1), duration: Math.max(0, item.duration - (song.duration || 0)) } : item));
      setMessage({ type: 'success', text: { key: 'message.removedFromPlaylist', values: { name: playlist.name } } });
      void refreshPlaylists();
    } catch (error) {
      if (session === sessionRequest.current) setMessage({ type: 'error', text: errorContent(error, 'error.removeFromPlaylist') });
    } finally { if (session === sessionRequest.current) setPlaylistSongRemoving(''); }
  };
  const addSongToPlaylist = async (playlistId: string, song: Song) => {
    if (!api || playlistSongAdding) return;
    setPlaylistSongAdding(song.id);
    try {
      const known = playlists.find((playlist) => playlist.id === playlistId);
      let name = known?.name || t('common.playlists');
      let existing = known?.songs;
      if (!existing) {
        try {
          const detail = await api.playlist(playlistId);
          name = detail.name || name;
          existing = detail.songs;
        } catch { /* duplicate check is best effort; never block the add on it */ }
      }
      if (existing?.some((entry) => entry.id === song.id)) {
        setMessage({ type: 'info', text: { key: 'message.alreadyInPlaylist', values: { name } } });
        return;
      }
      await api.addToPlaylist(playlistId, song.id);
      setMessage({ type: 'success', text: { key: 'message.addedToPlaylist', values: { name } } });
      void refreshPlaylists();
      if (selectedPlaylist?.id === playlistId) void api.playlist(playlistId).then((detail) => setSelectedPlaylist((current) => current?.id === playlistId ? detail : current)).catch(() => {});
    } catch (error) {
      setMessage({ type: 'error', text: errorContent(error, 'error.addToPlaylist') });
    } finally { setPlaylistSongAdding(''); }
  };
  const knownAlbums = () => {
    const candidates = [...albums, ...searchResults.albums, ...(selectedAlbum ? [selectedAlbum] : []), ...(selectedArtist?.albums || [])];
    const unique = new Map<string, Album>();
    for (const album of candidates) {
      const existing = unique.get(album.id);
      unique.set(album.id, existing && (existing.songs?.length || 0) >= (album.songs?.length || 0) ? existing : album);
    }
    return Array.from(unique.values());
  };
  const linkedAlbum = (song: Song) => albumForSong(song, knownAlbums(), !!api);
  const openSongAlbum = (song: Song) => {
    const album = linkedAlbum(song);
    if (album) void openAlbum(album);
  };
  const loadLibrarySongs = async (nextPage: number) => {
    const request = ++librarySongRequest.current;
    const session = sessionRequest.current;
    setLibrarySongLoading(true); setLibrarySongError('');
    try {
      const songs = api ? await api.songsPage(nextPage * LIBRARY_PAGE_SIZE, LIBRARY_PAGE_SIZE, albums) : localSongs.slice(nextPage * LIBRARY_PAGE_SIZE, (nextPage + 1) * LIBRARY_PAGE_SIZE);
      if (request === librarySongRequest.current && session === sessionRequest.current) {
        const hasNextPage = songs.length === LIBRARY_PAGE_SIZE;
        setLibrarySongs(songs); setLibrarySongPage(nextPage); setLibraryHasNext(hasNextPage);
        setLibraryKnownPageCount((count) => hasNextPage ? Math.max(count, nextPage + 2) : nextPage + 1);
      }
    } catch (error) {
      if (request === librarySongRequest.current && session === sessionRequest.current) setLibrarySongError(errorContent(error, 'error.loadSongs'));
    } finally { if (request === librarySongRequest.current && session === sessionRequest.current) setLibrarySongLoading(false); }
  };
  const randomPlay = async (count: number) => {
    const size = Math.max(1, Math.min(500, Math.round(count) || 20));
    try {
      const songs = api ? await api.randomSongs(size) : sampleSongs(localSongs, size);
      if (!songs.length) { setMessage({ type: 'info', text: { key: 'library.noTracks' } }); return; }
      playCollection(songs, true);
    } catch (error) {
      setMessage({ type: 'error', text: errorContent(error, 'error.loadRandomSongs') });
    }
  };
  const refreshRandom = async () => {
    const request = ++randomRequest.current;
    const session = sessionRequest.current;
    setRandomLoading(true); setRandomError('');
    try {
      const songs = api ? await api.randomSongs(9) : sampleSongs(localSongs);
      if (request === randomRequest.current && session === sessionRequest.current) setRandomSongs(songs);
    } catch (error) {
      if (request === randomRequest.current && session === sessionRequest.current) {
        setRandomError(errorContent(error, 'error.loadRandomSongs'));
        // Only fall back to songs from this server, never to unrelated local tracks.
        if (!randomSongs.length) setRandomSongs(sampleSongs(albums.flatMap((album) => album.songs || [])));
      }
    } finally { if (request === randomRequest.current && session === sessionRequest.current) setRandomLoading(false); }
  };
  const openArtist = async (name: string, artistId?: string, pushHistory = true) => {
    if (!name.trim()) return;
    albumRequest.current++; playlistRequest.current++;
    const request = ++artistRequest.current;
    const artistAlbums = knownAlbums().filter((album) => artistId ? album.artistId ? album.artistId === artistId : album.artist === name : album.artist === name || album.songs?.some((song) => song.artist === name));
    if (pushHistory) nav('artist', true);
    setSelectedArtist({ name, id: artistId, albums: artistAlbums, songs: artistAlbums.flatMap((album) => album.songs || []) });
    setArtistError(''); setArtistLoading(!!api);
    if (!api) return;
    let artistLookupFailed = false;
    let remoteAlbums: Album[] = [];
    if (artistId) {
      try { remoteAlbums = await api.artistAlbums(artistId); }
      catch { artistLookupFailed = true; }
      if (request !== artistRequest.current) return;
    }
    // Limit concurrent detail requests for artists with a large discography.
    const details = Array.from(new Map([...remoteAlbums, ...artistAlbums].map((album) => [album.id, album])).values());
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
    setSelectedArtist({ name, id: artistId, albums: details, songs: Array.from(new Map(details.flatMap((album) => album.songs || []).map((song) => [song.id, song])).values()) });
    setArtistLoading(false); setArtistError(failed || artistLookupFailed ? { key: 'error.someAlbumTracks' } : '');
  };
  const playSong = (song: Song, list?: Song[], entryIndex?: number) => {
    const source = list || selectedAlbum?.songs || [song];
    const identityIndex = source.indexOf(song);
    const index = entryIndex !== undefined && source[entryIndex] === song ? entryIndex : identityIndex >= 0 ? identityIndex : Math.max(0, source.findIndex((item) => item.id === song.id));
    const tracks = source.map((item) => ({ ...item, source: mode } as PlayerTrack));
    originalQueue.current = tracks;
    const prepared = queueAroundTrack(tracks, tracks[index], shuffle);
    setQueue(prepared.queue); setCurrentIndex(prepared.index);
  };
  const playCollection = (songs: Song[], random: boolean) => {
    if (!songs.length) return;
    const tracks = songs.map((song) => ({ ...song, source: mode } as PlayerTrack));
    originalQueue.current = tracks;
    setShuffle(random); setQueue(random ? shuffledItems(tracks) : tracks); setCurrentIndex(0);
  };
  const toggleShuffle = () => {
    const enabled = !shuffle;
    const prepared = queueAroundTrack(originalQueue.current, currentTrack, enabled);
    setShuffle(enabled); setQueue(prepared.queue); setCurrentIndex(prepared.index);
  };
  const togglePlay = () => {
    const audio = audioRef.current; if (!audio || !currentTrack) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else fadeAudio(audio, 0, 180, () => { audio.pause(); setPlaying(false); });
  };
  const next = () => {
    if (!queue.length) return;
    const nextIndex = (currentIndex + 1) % queue.length;
    if (!repeat && currentIndex === queue.length - 1) { fadeAudio(audioRef.current!, 0, 200, () => { audioRef.current?.pause(); setPlaying(false); }); return; }
    if (nextIndex === currentIndex && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => setPlaying(false)); }
    else setCurrentIndex(nextIndex);
  };
  const previous = () => { if (audioRef.current && audioRef.current.currentTime > 3) audioRef.current.currentTime = 0; else if (queue.length) setCurrentIndex((currentIndex - 1 + queue.length) % queue.length); };

  const primaryNav = [{ id: 'home' as const, label: t('nav.home'), icon: Home }, { id: 'library' as const, label: t('nav.library'), icon: Library }, { id: 'artists' as const, label: t('common.artists'), icon: Users }, { id: 'albums' as const, label: t('common.albums'), icon: AlbumIcon }];
  const isConnected = mode === 'server' && !!connectedSettings;
  const currentServerName = mode === 'local' ? t('server.localMode') : serverLabel(connectedSettings || settings);
  const resetDetailHistory = () => {
    detailHistory.current.clear(); historyScroll.current.clear();
    setNavigation((current) => {
      const active = current.pages[current.index];
      return { pages: [active === 'album' || active === 'artist' || active === 'playlist' ? 'home' : active], index: 0 };
    });
  };
  const rememberPage = () => {
    detailHistory.current.set(navigation.index, { album: selectedAlbum, albumLoading, albumError, playlist: selectedPlaylist, playlistLoading, playlistError, artist: selectedArtist, artistLoading, artistError });
    historyScroll.current.set(navigation.index, contentScrollRef.current?.scrollTop || 0);
  };
  const nav = (id: typeof page, newDetail = false) => {
    const target = id === 'search' ? 'library' : id;
    if (newDetail || target !== page) {
      rememberPage();
      for (const index of detailHistory.current.keys()) if (index > navigation.index) detailHistory.current.delete(index);
      for (const index of historyScroll.current.keys()) if (index > navigation.index) historyScroll.current.delete(index);
      setNavigation((current) => ({ pages: [...current.pages.slice(0, current.index + 1), target], index: current.index + 1 }));
      if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
    }
    setMobileNav(false); setServerMenuOpen(false);
    if (id === 'search') setFocusLibrarySearch(true);
  };
  const moveHistory = (step: number) => {
    const index = Math.max(0, Math.min(navigation.pages.length - 1, navigation.index + step));
    if (index === navigation.index) return;
    rememberPage();
    albumRequest.current++; artistRequest.current++; playlistRequest.current++;
    const saved = detailHistory.current.get(index);
    if (saved) {
      setSelectedAlbum(saved.album); setAlbumLoading(false); setAlbumError(saved.albumError);
      setSelectedPlaylist(saved.playlist); setPlaylistLoading(false); setPlaylistError(saved.playlistError);
      setSelectedArtist(saved.artist); setArtistLoading(false); setArtistError(saved.artistError);
    }
    setNavigation((current) => ({ ...current, index }));
    if (saved?.albumLoading && saved.album && navigation.pages[index] === 'album') void openAlbum(saved.album, false);
    if (saved?.playlistLoading && saved.playlist && navigation.pages[index] === 'playlist') void openPlaylist(saved.playlist, false);
    if (saved?.artistLoading && saved.artist && navigation.pages[index] === 'artist') void openArtist(saved.artist.name, saved.artist.id, false);
    setMobileNav(false); setServerMenuOpen(false);
  };
  const openConnectionSettings = () => { cancelPendingConnection(); setConnectionViewKey((key) => key + 1); nav('settings'); };
  const [playlistsCollapsed, setPlaylistsCollapsed] = useState(() => storageGet('tenma.playlistsCollapsed') === '1');
  const togglePlaylistsCollapsed = () => {
    const next = !playlistsCollapsed;
    setPlaylistsCollapsed(next);
    storageSet('tenma.playlistsCollapsed', next ? '1' : '');
  };
  const openPlaylistFromSidebar = (playlist: Playlist) => {
    setMobileNav(false);
    void openPlaylist(playlist);
  };
  const renderNavItem = ({ id, label, icon: Icon }: typeof primaryNav[number]) => {
    const active = page === id || (id === 'albums' && page === 'album') || (id === 'artists' && page === 'artist');
    return <button key={id} className={cn('nav-item', active && 'active')} aria-current={active ? 'page' : undefined} onClick={() => nav(id)}><Icon size={18} /><span>{label}</span></button>;
  };

  const customWallpaperSrc = backgroundImage && typeof window !== 'undefined' ? convertFileSrc(backgroundImage) : '';
  const wallpaperSrc = wallpaper === 'custom' ? customWallpaperSrc : wallpaper !== 'none' ? BUILTIN_WALLPAPERS[wallpaper].full : '';
  // Chrome alpha follows wallpaper visibility: more visible wallpaper -> more translucent panels (~54% at 40%, ~40% at 75%).
  const wallpaperShellStyle = wallpaperSrc ? { '--wp-pct': `${Math.round(70 - 40 * wallpaperOpacity / 100)}%`, '--wp-image': `url("${wallpaperSrc}")` } as React.CSSProperties : undefined;
  return <div className={cn('app-shell', wallpaperSrc && 'has-wallpaper', preferences.theme !== 'midnight' && `theme-${preferences.theme}`)} style={wallpaperShellStyle}>
    {wallpaperSrc ? <div className="app-wallpaper" aria-hidden="true" style={{ backgroundImage: `url("${wallpaperSrc}")`, opacity: wallpaperOpacity / 100, filter: wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : undefined }} /> : null}
    {createPlaylistOpen && <div className="modal-backdrop" onMouseDown={() => !creatingPlaylist && setCreatePlaylistOpen(false)}><section className="create-playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="create-playlist-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="create-playlist-title">{t('playlists.createTitle')}</h2><p>{t('playlists.createDescription')}</p><form onSubmit={createPlaylist}><label className="settings-field">{t('playlists.nameLabel')}<input autoFocus required maxLength={128} className="settings-input" value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder={t('playlists.namePlaceholder')} /></label><div className="settings-actions"><button type="button" className="secondary-button" disabled={creatingPlaylist} onClick={() => setCreatePlaylistOpen(false)}>{t('close.cancel')}</button><button type="submit" className="primary-button" disabled={creatingPlaylist || !newPlaylistName.trim()}>{creatingPlaylist ? <><LoaderCircle className="spin" size={16} />{t('playlists.creating')}</> : t('playlists.create')}</button></div></form></section></div>}
    {playlistContextMenu && <div className="playlist-context-menu" role="menu" style={{ left: playlistContextMenu.x, top: playlistContextMenu.y }}><button type="button" role="menuitem" onClick={openPlaylistCreation}><Plus size={16} />{t('playlists.create')}</button></div>}
    {closePromptOpen && <div className="close-prompt-backdrop" role="presentation"><section className="close-prompt" role="dialog" aria-modal="true" aria-labelledby="close-prompt-title"><h2 id="close-prompt-title">{t('close.title')}</h2><p>{t('close.description')}</p><label className="close-prompt-remember"><input type="checkbox" checked={rememberCloseChoice} onChange={(event) => setRememberCloseChoice(event.target.checked)} /><span>{t('close.remember')}</span></label><div className="close-prompt-actions"><button className="secondary-button" onClick={() => setClosePromptOpen(false)}>{t('close.cancel')}</button><button className="secondary-button" onClick={() => resolveCloseChoice('background')}>{t('close.background')}</button><button className="primary-button" onClick={() => resolveCloseChoice('quit')}>{t('close.quit')}</button></div></section></div>}
    {editingPlaylist && api && <PlaylistEditor key={editingPlaylist.id} playlist={editingPlaylist} onSave={(name) => renamePlaylist(editingPlaylist, name)} onDelete={() => deletePlaylist(editingPlaylist)} onClose={() => setEditingPlaylist(null)} />}
    <aside className={cn('sidebar', mobileNav && 'mobile-open')}>
      <div className="server-switcher" ref={serverSwitcherRef}>
        <button ref={serverButtonRef} className="server-switcher-button" aria-label={t('server.switch', { name: currentServerName })} aria-expanded={serverMenuOpen} aria-controls="server-options" onClick={() => setServerMenuOpen((open) => !open)}><span className={cn('status-dot', isConnected && 'online')} /><span className="server-switcher-copy"><strong>{currentServerName}</strong><small>{isConnected ? t('server.connected') : t('server.localMode')}</small></span><ChevronDown size={16} /></button>
        {serverMenuOpen && <div className="server-menu" id="server-options" aria-label={t('server.options')}>
          <p>{t('server.musicServer')}</p>
          {isConnected && <button className="server-option current" onClick={() => setServerMenuOpen(false)}><span className="status-dot online" /><span>{currentServerName}<small>{t('server.currentConnection')}</small></span><Check size={15} /></button>}
          <button className={cn('server-option', mode === 'local' && 'current')} onClick={() => { if (mode !== 'local' || connecting) useLocalMode(); nav('home'); }}><Disc3 size={17} /><span>{t('server.localMode')}<small>{localFolder || t('server.localHint')}</small></span>{mode === 'local' && <Check size={15} />}</button>
          {mode === 'local' && lastLogin.current.settings.server && <button className="server-option" disabled={connecting} onClick={() => { setServerMenuOpen(false); restoreRemoteConnection(); }}><Server size={17} /><span>{t('server.restoreRemote', { name: serverLabel(lastLogin.current.settings) })}</span></button>}
          <button className="server-option server-add" onClick={openConnectionSettings}><Plus size={17} /><span>{t('server.addSwitch')}</span></button>
          <small className="server-menu-note">{t('server.singleServerNote')}</small>
        </div>}
      </div>
      <nav className="sidebar-navigation" aria-label={t('nav.main')}>
        <div className="nav-group">{primaryNav.map(renderNavItem)}</div>
        <div className="nav-group playlists-nav" onContextMenu={openPlaylistContextMenu}>
          <div className="playlists-nav-heading">
            <button className="playlists-nav-title" onClick={() => { setMobileNav(false); nav('playlists'); }}>{t('common.playlists')}</button>
            <button type="button" className="icon-button playlists-create-button" aria-label={t('playlists.create')} title={t('playlists.create')} disabled={!api} onClick={openPlaylistCreation}><Plus size={15} /></button>
            <button className="icon-button playlists-nav-toggle" aria-label={t('nav.togglePlaylists')} aria-expanded={!playlistsCollapsed} onClick={togglePlaylistsCollapsed}><ChevronDown size={15} className={cn('playlists-toggle-icon', !playlistsCollapsed && 'open')} /></button>
          </div>
          {playlists.length ? (!playlistsCollapsed && <div className="playlists-nav-list">
            {playlists.map((playlist) => <button key={playlist.id} className={cn('playlist-nav-item', page === 'playlist' && selectedPlaylist?.id === playlist.id && 'active')} onClick={() => openPlaylistFromSidebar(playlist)}>
              <Cover src={playlist.coverArt} alt={playlist.name} className="playlist-nav-cover" />
              <span className="playlist-nav-copy"><strong>{playlist.name}</strong><small>{t('count.tracks', { count: playlist.songCount || 0 })}</small></span>
            </button>)}
          </div>) : <p className="playlists-nav-empty">{t('playlists.empty')}</p>}
        </div>
      </nav>
      <div className="sidebar-footer"><button className={cn('nav-item', page === 'settings' && 'active')} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => nav('settings')}><Settings size={18} /><span>{t('nav.settings')}</span></button></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label={t('nav.closeMenu')} onClick={() => setMobileNav(false)} />}
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-drag-zone" data-tauri-drag-region aria-hidden="true" />
        <div className="topbar-left">
          <button className="mobile-menu icon-button" aria-label={t('nav.openMenu')} onClick={() => setMobileNav(true)}><Menu size={20} /></button>
        </div>
        <div className="topbar-brand" aria-label="Tenma Player">Tenma Player</div>
        <div className="top-actions"><WindowControls onClose={() => requestWindowClose()} /></div>
      </header>
      <div className="content-scroll" ref={contentScrollRef}>
        {availableUpdate && <section className="update-banner" aria-live="polite"><div className="update-banner-copy"><strong>{t('update.bannerTitle', { version: availableUpdate.version })}</strong><span>{updateStatus === 'downloading' ? t('update.downloading', { progress: updateProgress }) : updateError ? resolveMessage(updateError, t) : t('update.ready')}</span></div>{updateStatus === 'downloading' ? <span className="update-progress" aria-label={t('update.progress', { progress: updateProgress })}><span style={{ width: `${updateProgress}%` }} /></span> : <><button className="primary-button compact" onClick={installUpdate}>{t('update.now')}</button><button className="update-dismiss" aria-label={t('update.remindLater')} onClick={() => { void availableUpdate.close(); setAvailableUpdate(null); }}>{t('update.later')}</button></>}</section>}
        {message && <div className="toast-spacer" />}
        {message && <div className={cn('toast', message.type)}>{message.type === 'success' ? '✓' : message.type === 'info' ? 'ℹ' : '!'} {resolveMessage(message.text, t)}<button aria-label={t('common.dismissNotification')} onClick={() => setMessage(null)}><X size={15} /></button></div>}
        <div key={page} className="content-page">
          {page === 'settings' ? <SettingsView key={connectionViewKey} openServerForm={connectionViewKey > 0} settings={settings} setSettings={editConnection} connected={connectedSettings} password={password} setPassword={(value) => { cancelPendingConnection(); setPassword(value); }} rememberPassword={rememberPassword} setRememberPassword={(value) => { cancelPendingConnection(); setRememberPassword(value); }} connect={connect} loading={connecting} mode={mode} useLocal={() => useLocalMode()} restoreRemote={restoreRemoteConnection} disconnect={disconnectRemote} backgroundImage={backgroundImage} onChooseBackground={chooseBackground} onClearBackground={clearBackground} wallpaper={wallpaper} onWallpaperChange={changeWallpaper} wallpaperOpacity={wallpaperOpacity} onWallpaperOpacityChange={changeWallpaperOpacity} wallpaperBlur={wallpaperBlur} onWallpaperBlurChange={changeWallpaperBlur} onWallpaperReset={resetWallpaper} customWallpaperSrc={customWallpaperSrc} localFolder={localFolder} localLoading={localLoading} localSongCount={localSongs.length} chooseLocalFolder={chooseLocalFolder} rescanLocalLibrary={() => loadLocalLibrary(localFolder, true)} rename={renameServer} preferences={preferences} setPreferences={setPreferences} updateVersion={availableUpdate?.version} updateStatus={updateStatus} updateProgress={updateProgress} updateError={resolveMessage(updateError, t)} updateMessage={updateMessage ? t(updateMessage) : ''} checkForUpdate={() => { if (!isTauri()) { setUpdateError({ key: 'update.unavailableWeb' }); setUpdateMessage(''); return; } setUpdateError(''); setUpdateMessage(''); setUpdateStatus('checking'); import('@tauri-apps/plugin-updater').then(({ check }) => check({ timeout: 15000 })).then((result) => { if (result) { setAvailableUpdate(result as AvailableUpdate); setUpdateMessage(''); } else setUpdateMessage('update.latest'); setUpdateStatus('idle'); }).catch((error: unknown) => { setUpdateStatus('error'); setUpdateError(errorContent(error, 'update.failedCheck')); }) }} installUpdate={installUpdate} /> : page === 'playlists' ? <PlaylistsView playlists={playlists} onOpen={openPlaylist} error={resolveMessage(playlistsError, t)} onRefresh={refreshPlaylists} loading={playlistsLoading} /> : page === 'playlist' ? <PlaylistDetailView onEdit={api ? (playlist) => setEditingPlaylist(playlist) : undefined} playlist={selectedPlaylist} loading={playlistLoading} error={resolveMessage(playlistError, t)} onBack={() => moveHistory(-1)} onPlay={playSong} onPlayCollection={playCollection} onArtist={openArtist} onAlbum={openSongAlbum} canOpenAlbum={(song) => !!linkedAlbum(song)} playlists={playlists} onAddToPlaylist={api ? addSongToPlaylist : undefined} onRemoveFromPlaylist={api && selectedPlaylist ? (song) => removeSongFromPlaylist(selectedPlaylist, song) : undefined} removingSongId={playlistSongRemoving} addingSongId={playlistSongAdding} showBitRate /> : page === 'album' ? <AlbumDetailView album={selectedAlbum} loading={albumLoading} error={resolveMessage(albumError, t)} onBack={() => moveHistory(-1)} onPlay={playSong} onPlayCollection={playCollection} onArtist={openArtist} onAlbum={openSongAlbum} canOpenAlbum={(song) => !!linkedAlbum(song)} playlists={playlists} onAddToPlaylist={api ? addSongToPlaylist : undefined} addingSongId={playlistSongAdding} showBitRate /> : page === 'artist' ? <ArtistDetailView artist={selectedArtist} loading={artistLoading} error={resolveMessage(artistError, t)} onBack={() => moveHistory(-1)} onOpen={openAlbum} onPlay={playSong} onArtist={openArtist} onAlbum={openSongAlbum} canOpenAlbum={(song) => !!linkedAlbum(song)} playlists={playlists} onAddToPlaylist={api ? addSongToPlaylist : undefined} addingSongId={playlistSongAdding} /> : page === 'artists' ? <ArtistsView albums={albums} onOpen={openArtist} /> : page === 'albums' ? <AlbumsView albums={albums} error={resolveMessage(albumsError, t)} onOpen={openAlbum} onArtist={openArtist} /> : page === 'library' || page === 'search' ? <LibraryView albums={albums} albumsError={resolveMessage(albumsError, t)} playlists={playlists} playlistsError={resolveMessage(playlistsError, t)} songs={librarySongs} songPage={librarySongPage} songLoading={librarySongLoading} songError={resolveMessage(librarySongError, t)} hasNext={libraryHasNext} knownPageCount={libraryKnownPageCount} query={query} onQuery={setQuery} results={searchResults} searchLoading={loading} onArtist={openArtist} onOpen={openAlbum} onPlay={playSong} onPage={loadLibrarySongs} onAddToPlaylist={api ? addSongToPlaylist : undefined} addingSongId={playlistSongAdding} showBitRate /> : <HomeView randomSongs={randomSongs} randomLoading={randomLoading} randomError={resolveMessage(randomError, t)} onRefreshRandom={refreshRandom} onPlay={playSong} playlists={playlists} onOpenPlaylist={(playlist) => { setMobileNav(false); void openPlaylist(playlist); }} mode={mode} localFolder={localFolder} onConnect={() => nav('settings')} onArtist={openArtist} />}
        </div>
      </div>
    </main>
    <audio ref={audioRef} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={() => { setPlaying(true); if (audioRef.current) fadeAudio(audioRef.current, perceivedVolume(volume), 280); }} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setMessage({ type: 'error', text: { key: 'player.failed' } }); }} onEnded={() => { setPlaying(false); if (preferences.autoNext) next(); }} />
    <Player track={currentTrack} playing={playing} currentTime={currentTime} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} onToggle={togglePlay} onPrevious={previous} onNext={next} onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} onVolume={changeVolume} onMute={toggleMute} onShuffle={toggleShuffle} onRepeat={() => setRepeat(!repeat)} showQueue={showQueue} onQueue={toggleQueue} onOpenNowPlaying={() => { setShowQueue(false); setNowPlayingOpen(true); }} onRandomPlay={randomPlay} />
    {nowPlayingOpen && <NowPlayingView audioRef={audioRef} track={currentTrack} queue={queue} queueIndex={currentIndex} playing={playing} currentTime={currentTime} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} closing={nowPlayingClosing} api={api} onClose={closeNowPlaying} onToggle={togglePlay} onPrevious={previous} onNext={next} onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} onVolume={changeVolume} onMute={toggleMute} onShuffle={toggleShuffle} onRepeat={() => setRepeat(!repeat)} onQueueSelect={(index) => { if (index === currentIndex) togglePlay(); else setCurrentIndex(index); }} playlists={playlists} onAddToPlaylist={api ? addSongToPlaylist : undefined} addingSongId={playlistSongAdding} onArtist={(name, artistId) => { closeNowPlaying(); openArtist(name, artistId); }} onAlbum={(song) => { closeNowPlaying(); openSongAlbum(song); }} canOpenAlbum={(song) => !!linkedAlbum(song)} />}
    {showQueue && <section ref={queuePanelRef} className={cn('queue-panel', queueClosing && 'leaving')} aria-label={t('player.queue')}><div className="group-title"><h2>{t('player.queue')}</h2><button className="icon-button" aria-label={t('player.closeQueue')} onClick={closeQueue}><X size={18} /></button></div>{queue.length ? queue.map((song, index) => <button key={`${song.id}-${index}`} className={cn('queue-track', index === currentIndex && 'control-active')} onClick={() => { if (index === currentIndex) togglePlay(); else setCurrentIndex(index); }}><Cover src={song.coverArt} alt={song.album} className="queue-track-cover" /><span className="queue-track-copy">{song.title}<small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span></button>) : <p>{t('player.emptyQueue')}</p>}</section>}

  </div>;
}

function HomeView({ randomSongs, randomLoading, randomError, onRefreshRandom, onPlay, onArtist, playlists, onOpenPlaylist, mode, localFolder, onConnect }: { randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onPlay: (song: Song, list?: Song[]) => void; onArtist: (name: string, artistId?: string) => void; playlists: Playlist[]; onOpenPlaylist: (playlist: Playlist) => void; mode: AppMode; localFolder: string; onConnect: () => void }) {
  const { t } = useI18n();
  return <section className="home-view">
    <div className="page-heading"><h1>{t('nav.home')}</h1><p>{t('library.description')}</p></div>
    {mode === 'local' && !localFolder && <p className="connection-hint">{t('home.localHint')} <button onClick={onConnect}>{t('home.chooseFolder')} <ChevronRight size={13} /></button></p>}
    <RecommendCards songs={randomSongs.slice(0, 9)} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} onArtist={onArtist} />
    {playlists.length > 0 && <>
      <div className="section-heading home-playlists-heading"><h2>{t('common.playlists')}</h2><span>{t('count.playlists', { count: playlists.length })}</span></div>
      <div className="home-playlist-grid">
        {playlists.map((playlist) => <button key={playlist.id} className="home-playlist-card" onClick={() => onOpenPlaylist(playlist)}>
          <Cover src={playlist.coverArt} alt={playlist.name} className="home-playlist-cover" />
          <strong>{playlist.name}</strong>
          <small>{playlist.owner || t('detail.currentAccount')}{playlist.songCount ? ` · ${t('count.tracks', { count: playlist.songCount })}` : ''}</small>
        </button>)}
      </div>
    </>}
  </section>;
}

function Pagination({ page, pageCount, onPage, hasNext = page < pageCount - 1 }: { page: number; pageCount: number; onPage: (page: number) => void; hasNext?: boolean }) {
  const { t } = useI18n();
  const safeCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(0, page), safeCount - 1);
  const windowSize = Math.min(5, safeCount);
  const start = safeCount <= 5 ? 0 : safePage <= 2 ? 0 : safePage >= safeCount - 3 ? safeCount - 5 : safePage - 2;
  const visible = Array.from({ length: windowSize }, (_, index) => start + index);
  return <nav className="pagination" aria-label={t('pagination.label')}>
    <button className="pagination-button pagination-arrow" aria-label={t('pagination.previousPage')} disabled={safePage === 0} onClick={() => onPage(safePage - 1)}><ChevronLeft size={16} /><span>{t('pagination.previous')}</span></button>
    {visible.map((index) => <button key={index} className={cn('pagination-button', index === safePage && 'active')} aria-current={index === safePage ? 'page' : undefined} onClick={() => onPage(index)}>{index + 1}</button>)}
    <button className="pagination-button pagination-arrow" aria-label={t('pagination.nextPage')} disabled={!hasNext || safePage >= safeCount - 1 && !hasNext} onClick={() => onPage(safePage + 1)}><span>{t('pagination.next')}</span><ChevronRight size={16} /></button>
  </nav>;
}

function AlbumsView({ albums, error, onOpen, onArtist }: { albums: Album[]; error: string; onOpen: (album: Album) => void; onArtist?: (name: string, artistId?: string) => void }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(albums.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="albums-view"><div className="section-heading"><h1>{t('common.albums')}</h1><span>{t('count.albums', { count: albums.length })}</span></div>{error ? <p className="inline-error">{t('albums.loadFailed', { error })}</p> : <p className="library-note">{t('albums.allLoaded')}</p>}{albums.length ? <><BalancedGrid className="album-grid" itemCount={Math.min(GRID_PAGE_SIZE, albums.length - currentPage * GRID_PAGE_SIZE)}>{albums.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} onArtist={onArtist} />)}</BalancedGrid><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title={t('albums.empty')} description={t('albums.emptyDescription')} icon={<AlbumIcon size={25} />} />}</section>;
}

function ArtistsView({ albums, onOpen }: { albums: Album[]; onOpen: (name: string, artistId?: string) => void }) {
  const { t } = useI18n();
  const artists = groupArtists(albums);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(artists.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="artists-view"><div className="section-heading"><h1>{t('common.artists')}</h1><span>{t('count.artists', { count: artists.length })}</span></div><p className="library-note">{t('artists.basedOnAlbums')}</p>{artists.length ? <><BalancedGrid className="artist-grid" itemCount={Math.min(GRID_PAGE_SIZE, artists.length - currentPage * GRID_PAGE_SIZE)} cardWidth={170} gap={24}>{artists.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((artist) => {
    return <button className="artist-item" key={artist.key} aria-label={t('artists.view', { name: artist.name })} onClick={() => onOpen(artist.name, artist.id)}><Cover src={artist.albums[0]?.coverArt} alt={artist.name} className="artist-avatar" /><strong>{artist.name}</strong><small>{t('count.albums', { count: artist.albums.length })}</small></button>;
  })}</BalancedGrid><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title={t('artists.empty')} description={t('artists.emptyDescription')} icon={<Users size={25} />} />}</section>;
}

function TrackTable({ songs, onPlay, playlists, onAddToPlaylist, addingSongId, onArtist, onAlbum, canOpenAlbum }: { songs: Song[]; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void } & DetailNavigation) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);
  useEffect(() => { setMenu(null); }, [songs]);
  const openMenu = (song: Song, event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ song, x: event.clientX, y: event.clientY });
  };
  return <div className="library-track-table with-menu with-bit-rate" onContextMenuCapture={(event) => {
    const row = (event.target as Element).closest<HTMLElement>('.library-track-row');
    if (!row) return;
    event.preventDefault(); event.stopPropagation();
    const index = Number(row.dataset.entryIndex);
    if (songs[index]) openMenu(songs[index], event);
  }}>
    <div className="library-track-heading" aria-hidden="true"><span>#</span><span>{t('track.title')}</span><span className="track-artist">{t('track.artist')}</span><span className="track-album">{t('track.album')}</span><span className="detail-track-bit-rate">{t('track.bitRate')}</span><span className="song-duration">{t('track.duration')}</span><span /></div>
    {songs.map((song, index) => <div key={`${song.id}-${index}`} data-entry-index={index} className="library-track-row" aria-label={t('player.playTrack', { title: song.title, artist: song.artist })} onClick={() => onPlay(song, songs, index)}>
      <span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="table-song"><Cover src={song.coverArt} alt={song.album} /><span className="song-main"><strong>{song.title}</strong><small>{song.artist}</small></span></span>
      <span className="track-artist"><MetadataLink label={t('artists.view', { name: song.artist })} onOpen={song.artist.trim() && onArtist ? () => onArtist(song.artist, song.artistId) : undefined}>{song.artist}</MetadataLink></span>
      <span className="track-album"><MetadataLink label={t('albums.view', { name: song.album })} onOpen={song.album.trim() && onAlbum && (!canOpenAlbum || canOpenAlbum(song)) ? () => onAlbum(song) : undefined}>{song.album}</MetadataLink></span>
      <span className="detail-track-bit-rate">{song.bitRate ? `${song.bitRate} kbps` : '—'}</span><span className="song-duration">{formatTime(song.duration)}</span><button type="button" className="detail-track-menu-button" aria-label={t('menu.moreActions')} aria-haspopup="menu" onClick={(event) => openMenu(song, event)}><MoreVertical size={16} /></button>
    </div>)}
    {menu && <TrackContextMenu song={menu.song} position={{ x: menu.x, y: menu.y }} playlists={playlists || []} adding={addingSongId === menu.song.id} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum && (!canOpenAlbum || canOpenAlbum(menu.song)) ? onAlbum : undefined} onClose={() => setMenu(null)} />}
  </div>;
}

function RecommendCards({ songs, loading, error, onRefresh, onPlay, onArtist }: { songs: Song[]; loading: boolean; error: string; onRefresh: () => void; onPlay: (song: Song, list?: Song[]) => void; onArtist: (name: string, artistId?: string) => void }) {
  const { t } = useI18n();
  return <><div className="section-heading"><h2>{t('recommend.title')}</h2><button className="secondary-button" disabled={loading} onClick={onRefresh}><Shuffle size={14} />{t('common.refresh')}</button></div>{error && <p className="inline-error">{error}</p>}{loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('recommend.choosing')}</div> : songs.length ? <div className="recommend-grid">{songs.map((song) => {
    const playLabel = t('player.playTrack', { title: song.title, artist: song.artist });
    return <div className="recommend-card" key={song.id}>
      <button type="button" className="recommend-cover-button" aria-label={playLabel} onClick={() => onPlay(song, songs)}><Cover src={song.coverArt} alt={song.album} /></button>
      <span className="recommend-copy"><button type="button" className="recommend-track-title" onClick={() => onPlay(song, songs)}><strong>{song.title}</strong></button><small><MetadataLink label={t('artists.view', { name: song.artist })} onOpen={() => onArtist(song.artist, song.artistId)}>{song.artist}</MetadataLink>{song.album && <> · {song.album}</>}</small></span>
      <button type="button" className="recommend-play" aria-label={playLabel} onClick={() => onPlay(song, songs)}><Play size={15} fill="currentColor" /></button>
    </div>;
  })}</div> : <EmptyPage title={t('recommend.empty')} description={t('recommend.emptyDescription')} icon={<Music2 size={25} />} />}</>;
}

function SearchResultsCards({ results, loading, onArtist, onOpen, onPlay }: { results: SearchResults; loading: boolean; onArtist: (name: string, artistId?: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  const { t } = useI18n();
  if (loading) return <div className="loading-state"><LoaderCircle className="spin" size={25} />{t('search.loading')}</div>;
  return <>{results.songs.length > 0 && <div className="result-group"><div className="group-title"><h2>{t('common.tracks')}</h2><span>{results.songs.length}</span></div><div className="search-result-grid">{results.songs.map((song) => {
    const playLabel = t('player.playTrack', { title: song.title, artist: song.artist });
    return <div className="search-result-card" key={song.id}>
      <button type="button" className="recommend-cover-button" aria-label={playLabel} onClick={() => onPlay(song, results.songs)}><Cover src={song.coverArt} alt={song.album} /></button>
      <span className="recommend-copy"><button type="button" className="recommend-track-title" onClick={() => onPlay(song, results.songs)}><strong>{song.title}</strong></button><small><MetadataLink label={t('artists.view', { name: song.artist })} onOpen={() => onArtist(song.artist, song.artistId)}>{song.artist}</MetadataLink>{song.album && <> · {song.album}</>}</small></span>
      <button type="button" className="recommend-play" aria-label={playLabel} onClick={() => onPlay(song, results.songs)}><Play size={15} /></button>
    </div>;
  })}</div></div>}{results.albums.length > 0 && <div className="result-group"><div className="group-title"><h2>{t('common.albums')}</h2><span>{results.albums.length}</span></div><BalancedGrid className="album-grid search-grid" itemCount={results.albums.length}>{results.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} onArtist={onArtist} />)}</BalancedGrid></div>}{results.artists.length > 0 && <div className="result-group"><div className="group-title"><h2>{t('common.artists')}</h2><span>{results.artists.length}</span></div><div className="artist-pills">{results.artists.map((artist) => <button key={artist.id} onClick={() => onArtist(artist.name, artist.id)}><span className="artist-avatar">{artist.name[0]}</span>{artist.name}</button>)}</div></div>}{!results.songs.length && !results.albums.length && !results.artists.length && <EmptyPage title={t('search.noResults')} description={t('search.noResultsDescription')} icon={<Search size={25} />} />}</>;
}

function LibraryView({ albums, albumsError, playlists, playlistsError, songs, songPage, songLoading, songError, hasNext, knownPageCount, query, onQuery, results, searchLoading, onArtist, onOpen, onPlay, onPage, onAddToPlaylist, addingSongId }: { albums: Album[]; albumsError: string; playlists: Playlist[]; playlistsError: string; songs: Song[]; songPage: number; songLoading: boolean; songError: string; hasNext: boolean; knownPageCount: number; query: string; onQuery: (query: string) => void; results: SearchResults; searchLoading: boolean; onArtist: (name: string, artistId?: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void; onPage: (page: number) => void; onAddToPlaylist?: (playlistId: string, song: Song) => void; addingSongId?: string } & DetailNavigation) {
  const { t, language } = useI18n();
  const openSongAlbum = (song: Song) => {
    const album = albumForSong(song, [...albums, ...results.albums], false);
    if (album) onOpen(album);
  };
  const songCount = indexedSongCount(albums);
  const hasSongCounts = albums.some((album) => album.songCount !== undefined || album.songs?.length !== undefined);
  const stats = [{ label: t('common.tracks'), count: albumsError || !hasSongCounts ? null : songCount, icon: Music2 }, { label: t('common.albums'), count: albumsError ? null : albums.length, icon: AlbumIcon }, { label: t('common.artists'), count: albumsError ? null : groupArtists(albums).length, icon: Users }, { label: t('common.playlists'), count: playlistsError ? null : playlists.length, icon: ListMusic }];
  return <section className="library-view"><div className="page-heading"><h1>{t('nav.library')}</h1><p>{t('library.description')}</p></div>
    <div className="library-search"><Search size={21} /><input className="library-search-input" aria-label={t('search.input')} placeholder={t('search.placeholder')} value={query} onChange={(event) => onQuery(event.target.value)} />{query && <button className="icon-button" aria-label={t('search.clear')} onClick={() => onQuery('')}><X size={18} /></button>}</div>
    <div className="library-stats">{stats.map(({ label, count, icon: Icon }) => <div className="library-stat" key={label}><Icon size={21} /><span>{label}<strong>{count === null ? '—' : count.toLocaleString(language)}</strong></span></div>)}</div>
    {albumsError && <p className="inline-error">{t('albums.loadFailed', { error: albumsError })}</p>}{playlistsError && <p className="inline-error">{playlistsError}</p>}
    {query.trim() ? <><div className="section-heading"><h2>{t('search.results')}</h2></div><SearchResultsCards results={results} loading={searchLoading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /></> : <><div className="section-heading library-songs-heading"><h2>{t('library.allTracks')}</h2><span>{t('library.page', { page: songPage + 1 })}</span></div>{songError && <p className="inline-error">{songError} {t('library.songErrorSuffix')}</p>}{songLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('library.loadingTracks')}</div> : songs.length ? <TrackTable songs={songs} onPlay={onPlay} playlists={playlists} onAddToPlaylist={onAddToPlaylist} addingSongId={addingSongId} onArtist={onArtist} onAlbum={openSongAlbum} canOpenAlbum={(song) => !!albumForSong(song, [...albums, ...results.albums], false)} /> : <EmptyPage title={t('library.noTracks')} description={t('library.noTracksDescription')} icon={<Music2 size={25} />} />}<Pagination page={songPage} pageCount={knownPageCount} hasNext={!songLoading && hasNext} onPage={onPage} /></>}
  </section>;
}

// Kept as a compatibility export for older integrations; the app routes search into LibraryView.
function SearchView({ query, onQuery, results, loading, randomSongs, randomLoading, randomError, onRefreshRandom, onArtist, onOpen, onPlay }: { query: string; onQuery: (query: string) => void; results: SearchResults; loading: boolean; randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onArtist: (name: string, artistId?: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  const { t } = useI18n();
  return <section className="search-view"><div className="search-hero"><Search size={21} /><input aria-label={t('search.inputWithAnd')} value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t('search.placeholder')} /></div>{query.trim() ? <SearchResultsCards results={results} loading={loading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /> : <RecommendCards songs={randomSongs} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} onArtist={onArtist} />}</section>;
}

function EmptyPage({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) { return <div className="empty-page"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p></div>; }

function DetailBack({ label, onBack }: { label?: string; onBack: () => void }) {
  const { t } = useI18n();
  return <button className="detail-back" onClick={onBack}><ChevronLeft size={17} />{label || t('common.back')}</button>;
}

function ArtistDetailView({ artist, loading, error, onBack, onOpen, onPlay, onArtist, onAlbum, canOpenAlbum, playlists, onAddToPlaylist, addingSongId }: { artist: ArtistDetail | null; loading: boolean; error: string; onBack: () => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void } & DetailNavigation) {
  const { t } = useI18n();
  if (!artist) return <section className="detail-page"><DetailBack onBack={onBack} /></section>;
  return <section className="detail-page artist-detail"><DetailBack onBack={onBack} />
    <div className="detail-header"><Cover src={artist.albums[0]?.coverArt} alt={artist.name} className="detail-cover artist-avatar" /><div className="detail-content"><p className="eyebrow">{t('track.artist')}</p><h1>{artist.name}</h1><p className="detail-meta">{t('count.albums', { count: artist.albums.length })} · {loading ? t('library.loadingTracks') : t('count.tracks', { count: artist.songs.length })}</p><button className="primary-button" disabled={loading || !artist.songs.length} onClick={() => onPlay(artist.songs[0], artist.songs)}><Play size={16} fill="currentColor" />{t('detail.playTracks')}</button></div></div>
    <div className="detail-section-heading"><h2>{t('common.albums')}</h2><span>{artist.albums.length}</span></div>
    {artist.albums.length ? <BalancedGrid className="album-grid" itemCount={artist.albums.length}>{artist.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} onArtist={onArtist} />)}</BalancedGrid> : <p className="library-note">{t('detail.noArtistAlbums')}</p>}
    <div className="detail-section-heading"><h2>{t('common.tracks')}</h2><span>{artist.songs.length}</span></div>
    {error && <p className="inline-error">{error}</p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('detail.loadingArtistTracks')}</div> : artist.songs.length ? <TrackTable songs={artist.songs} onPlay={onPlay} playlists={playlists} onAddToPlaylist={onAddToPlaylist} addingSongId={addingSongId} onArtist={onArtist} onAlbum={onAlbum} canOpenAlbum={canOpenAlbum} /> : <EmptyPage title={t('library.noTracks')} description={t('detail.noArtistTracks')} icon={<Music2 size={25} />} />}
  </section>;
}

function DetailPlayActions({ playLabel, songs, disabled, onPlayCollection }: { playLabel: string; songs: Song[]; disabled: boolean; onPlayCollection: (songs: Song[], random: boolean) => void }) {
  const { t } = useI18n();
  return <div className="detail-play-actions">
    <button type="button" className="primary-button" disabled={disabled || !songs.length} onClick={() => onPlayCollection(songs, false)}><Play size={16} fill="currentColor" />{playLabel}</button>
    <button type="button" className="secondary-button" disabled={disabled || !songs.length} onClick={() => onPlayCollection(songs, true)}><Shuffle size={16} />{t('detail.shufflePlay')}</button>
  </div>;
}

function MetadataLink({ children, label, onOpen }: { children: React.ReactNode; label: string; onOpen?: () => void }) {
  return onOpen ? <button type="button" className="metadata-link" aria-label={label} onClick={(event) => { event.stopPropagation(); onOpen(); }}>{children}</button> : <span onClick={(event) => event.stopPropagation()}>{children}</span>;
}

interface DetailNavigation {
  onArtist?: (name: string, artistId?: string) => void;
  onAlbum?: (song: Song) => void;
  canOpenAlbum?: (song: Song) => boolean;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  removingSongId?: string;
  addingSongId?: string;
  showBitRate?: boolean;
}

function DetailTrackList({ songs, fallbackCover, onPlay, onArtist, onAlbum, canOpenAlbum, playlists, onAddToPlaylist, onRemoveFromPlaylist, removingSongId, addingSongId, showBitRate = false }: { songs: Song[]; fallbackCover?: string; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void } & DetailNavigation) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | null>(null);
  useEffect(() => { setMenu(null); }, [songs]);
  const openMenu = (song: Song, event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ song, x: event.clientX, y: event.clientY });
  };
  return <div className={cn('detail-track-list', showBitRate && 'with-bit-rate', playlists && 'with-menu')} onContextMenuCapture={(event) => {
    const row = (event.target as Element).closest<HTMLElement>('.detail-track');
    if (!playlists || !row) return;
    event.preventDefault(); event.stopPropagation();
    const index = Number(row.dataset.entryIndex);
    if (songs[index]) openMenu(songs[index], event);
  }}>
    <div className="detail-track-heading" aria-hidden="true"><span>#</span><span>{t('track.title')}</span><span className="detail-track-artist">{t('track.artist')}</span><span className="detail-track-album">{t('track.album')}</span>{showBitRate && <span className="detail-track-bit-rate">{t('track.bitRate')}</span>}<span className="song-duration">{t('track.duration')}</span><span /></div>
    {songs.map((song, index) => {
      const playLabel = t('player.playTrack', { title: song.title, artist: song.artist });
      const play = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onPlay(song, songs, index); };
      const artistLink = <MetadataLink label={t('artists.view', { name: song.artist })} onOpen={song.artist.trim() && onArtist ? () => onArtist(song.artist, song.artistId) : undefined}>{song.artist}</MetadataLink>;
      const albumLink = <MetadataLink label={t('albums.view', { name: song.album })} onOpen={song.album.trim() && onAlbum && (!canOpenAlbum || canOpenAlbum(song)) ? () => onAlbum(song) : undefined}>{song.album}</MetadataLink>;
      return <div className="detail-track" data-entry-index={index} key={`${song.id}-${index}`} onClick={() => onPlay(song, songs, index)}>
        <span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="detail-track-song">
          <button type="button" className="detail-track-art-button" aria-label={playLabel} onClick={play}><Cover src={song.coverArt || fallbackCover} alt={song.album || song.title} className="detail-track-cover" /></button>
          <span className="detail-track-main"><button type="button" className="detail-track-title" aria-label={playLabel} onClick={play}><strong>{song.title}</strong></button><small>{artistLink}{song.album && <> · {albumLink}</>}</small></span>
        </span>
        <span className="detail-track-artist">{artistLink}</span><span className="detail-track-album">{albumLink}</span>
        {showBitRate && <span className="detail-track-bit-rate">{song.bitRate ? `${song.bitRate} kbps` : '—'}</span>}
      <span className="song-duration">{formatTime(song.duration)}</span><span className="detail-track-actions"><button type="button" className="detail-track-play-icon" aria-label={playLabel} onClick={play}><Play size={16} /></button>{playlists && <button type="button" className="detail-track-menu-button" aria-label={t('menu.moreActions')} aria-haspopup="menu" onClick={(event) => openMenu(song, event)}><MoreVertical size={16} /></button>}</span>
      </div>;
    })}
    {menu && <TrackContextMenu song={menu.song} position={{ x: menu.x, y: menu.y }} playlists={playlists || []} adding={addingSongId === menu.song.id} removing={removingSongId === menu.song.id} onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={onRemoveFromPlaylist ? () => onRemoveFromPlaylist(menu.song) : undefined} onArtist={onArtist} onAlbum={onAlbum && (!canOpenAlbum || canOpenAlbum(menu.song)) ? onAlbum : undefined} onClose={() => setMenu(null)} />}
  </div>;
}

function AlbumDetailView({ album, loading, error, onBack, onPlay, onPlayCollection, onArtist, playlists, onAddToPlaylist, addingSongId, showBitRate }: { album: Album | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void; onPlayCollection: (songs: Song[], random: boolean) => void } & DetailNavigation) {
  const { t } = useI18n();
  if (!album) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title={t('detail.albumNotFound')} description={t('detail.albumRemoved')} icon={<AlbumIcon size={25} />} /></section>;
  const songs = album.songs || [];
  return <section className="detail-page">
    <DetailBack onBack={onBack} />
    <div className="detail-header">
      <Cover src={album.coverArt} alt={album.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">{t('track.album')}</p><h1>{album.name}</h1><p className="detail-meta"><MetadataLink label={t('artists.view', { name: album.artist })} onOpen={album.artist.trim() && onArtist ? () => onArtist(album.artist, album.artistId) : undefined}>{album.artist}</MetadataLink>{album.year ? ` · ${album.year}` : ''}{album.songCount || songs.length ? ` · ${t('count.tracks', { count: album.songCount || songs.length })}` : ''}</p><DetailPlayActions playLabel={t('detail.playAlbum')} songs={songs} disabled={loading || !!error} onPlayCollection={onPlayCollection} /></div>
    </div>
    <div className="detail-section-heading"><h2>{t('common.tracks')}</h2><span>{loading ? t('common.loading') : t('count.tracks', { count: songs.length })}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('detail.loadingAlbumTracks')}</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>{t('common.back')}</button></div> : songs.length ? <DetailTrackList songs={songs} fallbackCover={album.coverArt} onPlay={onPlay} onArtist={onArtist} playlists={playlists} onAddToPlaylist={onAddToPlaylist} addingSongId={addingSongId} showBitRate={showBitRate} /> : <EmptyPage title={t('library.noTracks')} description={t('detail.noAlbumTracks')} icon={<Music2 size={25} />} />}
  </section>;
}

function PlaylistDetailView({ playlist, loading, error, onBack, onPlay, onPlayCollection, onEdit, onArtist, onAlbum, canOpenAlbum, playlists, onAddToPlaylist, onRemoveFromPlaylist, removingSongId, addingSongId, showBitRate }: { playlist: Playlist | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[], entryIndex?: number) => void; onPlayCollection: (songs: Song[], random: boolean) => void; onEdit?: (playlist: Playlist) => void } & DetailNavigation) {
  const { t } = useI18n();
  if (!playlist) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title={t('detail.playlistNotFound')} description={t('detail.playlistRemoved')} icon={<ListMusic size={25} />} /></section>;
  const songs = playlist.songs || [];
  return <section className="detail-page">
    <DetailBack onBack={onBack} />
    <div className="detail-header">
      <Cover src={playlist.coverArt} alt={playlist.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">{t('common.playlist')} · {playlist.public ? t('common.public') : t('common.private')}</p><h1>{playlist.name}</h1><p className="detail-meta">{playlist.owner || t('detail.currentAccount')} · {t('count.tracks', { count: playlist.songCount || songs.length })} · {formatTime(playlist.duration)}</p>{playlist.comment && <p className="detail-description">{playlist.comment}</p>}<DetailPlayActions playLabel={t('detail.playPlaylist')} songs={songs} disabled={loading || !!error} onPlayCollection={onPlayCollection} />{onEdit && <button type="button" className="secondary-button playlist-edit-button" disabled={loading} onClick={() => onEdit(playlist)}>{t('playlists.edit')}</button>}</div>
    </div>
    <div className="detail-section-heading"><h2>{t('common.tracks')}</h2><span>{loading ? t('common.loading') : t('count.tracks', { count: songs.length })}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('detail.loadingPlaylistTracks')}</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>{t('common.back')}</button></div> : songs.length ? <DetailTrackList songs={songs} onPlay={onPlay} onArtist={onArtist} onAlbum={onAlbum} canOpenAlbum={canOpenAlbum} playlists={playlists} onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={onRemoveFromPlaylist} removingSongId={removingSongId} addingSongId={addingSongId} showBitRate={showBitRate} /> : <EmptyPage title={t('library.noTracks')} description={t('detail.noPlaylistTracks')} icon={<ListMusic size={25} />} />}
  </section>;
}

function Player({ track, playing, currentTime, duration, volume, muted, shuffle, repeat, onToggle, onPrevious, onNext, onSeek, onVolume, onMute, onShuffle, onRepeat, showQueue, onQueue, onOpenNowPlaying, onRandomPlay }: { track?: PlayerTrack; playing: boolean; currentTime: number; duration: number; volume: number; muted: boolean; shuffle: boolean; repeat: boolean; onToggle: () => void; onPrevious: () => void; onNext: () => void; onSeek: (value: number) => void; onVolume: (value: number) => void; onMute: () => void; onShuffle: () => void; onRepeat: () => void; showQueue: boolean; onQueue: () => void; onOpenNowPlaying: () => void; onRandomPlay: (count: number) => Promise<void> | void }) {
  const { t } = useI18n();
  const [randomOpen, setRandomOpen] = useState(false);
  const [randomClosing, setRandomClosing] = useState(false);
  const [randomCount, setRandomCount] = useState('20');
  const [randomLoading, setRandomLoading] = useState(false);
  const randomPopoverRef = useRef<HTMLDivElement>(null);
  const randomTriggerRef = useRef<HTMLButtonElement>(null);
  const closeRandomPopover = () => {
    if (!randomOpen || randomClosing) return;
    setRandomClosing(true);
    window.setTimeout(() => { setRandomOpen(false); setRandomClosing(false); }, 180);
  };
  useEffect(() => {
    if (!randomOpen) return;
    const dismiss = (event: PointerEvent) => { if (!randomPopoverRef.current?.contains(event.target as Node) && !randomTriggerRef.current?.contains(event.target as Node)) closeRandomPopover(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRandomPopover(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [randomOpen]);
  const startRandomPlay = async () => {
    if (randomLoading) return;
    setRandomLoading(true);
    try { await onRandomPlay(Number(randomCount) || 20); setRandomOpen(false); }
    finally { setRandomLoading(false); }
  };
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  const handleVolumeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    onVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05));
  };
  return <footer className="player">
    <button className="now-playing now-playing-button" disabled={!track} aria-label={t('player.openNowPlaying')} onClick={onOpenNowPlaying}>{track ? <Cover src={track.coverArt} alt={track.album} className="player-art" /> : <div className="player-art player-placeholder"><Music2 size={22} /></div>}<div className="track-label"><strong>{track?.title || t('player.notPlaying')}</strong><span>{track?.artist || t('player.chooseTrack')}</span></div></button>
    <div className="player-center"><div className="player-controls">
      <button aria-label={t('common.shuffle')} aria-pressed={shuffle} className={cn(shuffle && 'control-active')} onClick={onShuffle}><Shuffle size={17} /></button>
      <button aria-label={t('common.previousTrack')} disabled={!track} onClick={onPrevious}><SkipBack size={19} fill="currentColor" /></button>
      <button className="play-button" aria-label={playing ? t('common.pause') : t('common.play')} onClick={onToggle} disabled={!track}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <button aria-label={t('common.nextTrack')} disabled={!track} onClick={onNext}><SkipForward size={19} fill="currentColor" /></button>
      <button aria-label={t('common.repeat')} aria-pressed={repeat} className={cn(repeat && 'control-active')} onClick={onRepeat}><Repeat size={17} /></button>
      <div className="random-play-anchor">
        <button ref={randomTriggerRef} className={cn('random-play-trigger', randomOpen && 'control-active')} aria-label={t('player.randomPlay')} aria-expanded={randomOpen} onClick={() => setRandomOpen(!randomOpen)}><Dices size={18} /></button>
        {randomOpen && <div ref={randomPopoverRef} className={cn('random-play-popover', randomClosing && 'leaving')} role="dialog" aria-label={t('player.randomPlay')}>
          <label className="random-play-count"><span>{t('player.randomPlayCount')}</span>
            <div className="random-play-row">
              <input type="number" min={1} max={500} value={randomCount} onChange={(event) => setRandomCount(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void startRandomPlay(); }} />
              <button type="button" className="random-play-go" disabled={randomLoading} aria-label={t('player.randomPlayStart')} onClick={() => void startRandomPlay()}>{randomLoading ? <LoaderCircle className="spin" size={16} /> : <img src="/icon.png" alt="" className="random-play-logo" />}</button>
            </div>
          </label>
        </div>}
      </div>
    </div><div className="progress-row"><span>{formatTime(currentTime)}</span><input className="progress-range" aria-label={t('player.progress')} type="range" min="0" max={total} disabled={!track || !total} step="1" value={Math.min(currentTime, total)} style={{ '--range-progress': `${total ? currentTime / total * 100 : 0}%` } as React.CSSProperties} onChange={(e) => onSeek(Number(e.target.value))} /><span>{formatTime(total)}</span></div></div>
    <div className="player-extra" onWheel={handleVolumeWheel}><button className="volume-button" aria-label={muted || volume === 0 ? t('common.unmute') : t('common.mute')} aria-pressed={muted || volume === 0} onClick={onMute}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="volume-range" aria-label={t('common.volume')} type="range" min="0" max="1" step="0.01" value={volume} style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties} onChange={(e) => onVolume(Number(e.target.value))} /><button aria-label={t('player.queue')} aria-pressed={showQueue} className={cn(showQueue && 'control-active')} onClick={onQueue}><ListMusic size={20} /></button></div>
  </footer>;
}

export default App;
