import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Album as AlbumIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, Home, Library, ListMusic, LoaderCircle, Menu, Minus, Music2, Pause, Play, Plus, Repeat, Search, Settings, Shuffle, SkipBack, SkipForward, Square, Users, Volume2, VolumeX, X } from 'lucide-react';
import { NavidromeApi } from './api';
import { demoAlbums, demoPlaylists, demoSongs, demoSearch } from './demoData';
import type { Album, AppMode, ConnectionSettings, Playlist, PlayerTrack, SearchResults, Song } from './types';
import { cn, coverFallback, formatTime } from './utils';

import { SettingsView, loadPreferences, serverLabel } from './SettingsView';
import type { Page } from './SettingsView';
import { PlaylistsView } from './PlaylistsView';
import { NowPlayingView } from './NowPlayingView';

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
    void action().catch((error: unknown) => console.error('Window control failed', error));
  };
  return <div className="window-controls" aria-label="Window controls" onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" aria-label="Minimize" onClick={(event) => runWindowAction(event, () => currentWindow.minimize())}><Minus size={14} /></button>
    <button type="button" aria-label="Maximize" onClick={(event) => runWindowAction(event, () => currentWindow.toggleMaximize())}><Square size={12} /></button>
    <button type="button" className="window-close" aria-label="Close" onClick={(event) => runWindowAction(event, () => currentWindow.close())}><X size={15} /></button>
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
type AvailableUpdate = { version: string; body?: string; downloadAndInstall: (onEvent: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>; close: () => Promise<void> };

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
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
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
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'downloading' | 'error'>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [settings, setSettings] = useState(storedSettings);
  const [rememberPassword, setRememberPasswordState] = useState(() => storageGet('northstar.rememberPassword') === 'true');
  const [password, setPassword] = useState(() => storageGet('northstar.rememberPassword') === 'true' ? storageGet('northstar.password') : '');
  const [isConnected, setIsConnected] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const allowWindowClose = useRef(false);
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
  const [muted, setMuted] = useState(false);
  const lastVolume = useRef(volume || 0.78);
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

  useEffect(() => {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void currentWindow.onCloseRequested(async (event) => {
      if (allowWindowClose.current) return;
      event.preventDefault();
      const remembered = storageGet('tenma.closeBehavior');
      if (remembered === 'background') { await currentWindow.minimize(); return; }
      if (remembered === 'quit') {
        allowWindowClose.current = true;
        try { await currentWindow.close(); } catch { allowWindowClose.current = false; }
        return;
      }
      setRememberCloseChoice(false);
      setClosePromptOpen(true);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, []);

  const resolveCloseChoice = async (choice: 'background' | 'quit') => {
    if (rememberCloseChoice) storageSet('tenma.closeBehavior', choice);
    setClosePromptOpen(false);
    const currentWindow = getCurrentWindow();
    if (choice === 'background') { await currentWindow.minimize(); return; }
    allowWindowClose.current = true;
    try { await currentWindow.close(); } catch { allowWindowClose.current = false; }
  };

  useEffect(() => { storageSet('northstar.preferences', JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { setVolume(preferences.defaultVolume); lastVolume.current = preferences.defaultVolume; setMuted(false); }, [preferences.defaultVolume]);

  const changeVolume = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    if (next > 0) lastVolume.current = next;
    setMuted(next === 0);
    setVolume(next);
  };
  const toggleMute = () => {
    if (muted || volume === 0) { const restored = lastVolume.current || 0.78; setMuted(false); setVolume(restored); }
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
      else setUpdateMessage('You are already running the latest version');
      setUpdateStatus('idle');
    }).catch((error: unknown) => {
      if (!cancelled) { setUpdateStatus('error'); setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates'); setUpdateMessage(''); }
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
      setUpdateStatus('error'); setUpdateError(error instanceof Error ? error.message : 'Failed to download the update');
    }
  };

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
      catch (error) { if (!cancelled) setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Search failed' }); }
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
        nextApi.recentAlbums().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Album[], error: error instanceof Error ? error.message : 'Failed to load recent albums' })),
        nextApi.allAlbums().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Album[], error: error instanceof Error ? error.message : 'Failed to load all albums' })),
        nextApi.playlists().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Playlist[], error: error instanceof Error ? error.message : 'Failed to load playlists' })),
        nextApi.randomSongs().then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: error instanceof Error ? error.message : 'Failed to load random songs' }))
      ]);
      if (all.value.length) nextApi.setAlbumIndex(all.value);
      const songs = await nextApi.songsPage(0, LIBRARY_PAGE_SIZE, all.value).then((value) => ({ value, error: '' })).catch((error: unknown) => ({ value: [] as Song[], error: error instanceof Error ? error.message : 'The song list is temporarily unavailable. Please try again later.' }));
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
      setRandomSongs(random.value); setRandomError(random.error); setPlaylists(lists.value); setPlaylistsError(lists.error ? `Failed to load playlists: ${lists.error}. Refresh to try again.` : '');
      // Keep the password in memory for this session even when local saving is
      // disabled, so enabling the toggle after a successful connection works.
      setIsConnected(true); setConnectedSettings(saved); setSettings(saved);
      storageSet('northstar.server', saved.server); storageSet('northstar.username', saved.username); storageSet('northstar.serverName', saved.serverName);
      storageSet('northstar.rememberPassword', String(rememberPassword));
      if (rememberPassword) storageSet('northstar.password', password); else storageRemove('northstar.password');
      const errors = [all.error && `All albums: ${all.error}`, recent.error && `Recent albums: ${recent.error}`, lists.error && `Playlists: ${lists.error}`, random.error && `Recommendations: ${random.error}`, songs.error && `Songs: ${songs.error}`].filter(Boolean);
      setMessage({ type: errors.length ? 'error' : 'success', text: `Connected to ${saved.serverName}${errors.length ? `; Some content failed to load (${errors.join('; ')})` : ''}` });
    } catch (error) { if (session === sessionRequest.current) setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Connection failed. Check the server address and credentials.' }); }
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
    setMessage({ type: 'success', text: 'Switched to demo mode' });
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
    catch (error) { if (session === sessionRequest.current) setPlaylistsError(error instanceof Error ? error.message : 'Failed to load playlists. Please try again.'); }
    finally { if (session === sessionRequest.current) setPlaylistsLoading(false); }
  };
  const openPlaylist = async (playlist: Playlist) => {
    const request = ++playlistRequest.current;
    setSelectedPlaylist(playlist); setPlaylistError(''); setPlaylistLoading(false); nav('playlist');
    if (!api || playlist.songs) return;
    setPlaylistLoading(true);
    try { const detail = await api.playlist(playlist.id); if (request === playlistRequest.current) setSelectedPlaylist(detail); }
    catch (error) { if (request === playlistRequest.current) setPlaylistError(error instanceof Error ? error.message : 'Failed to load playlist'); }
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
      if (request === albumRequest.current) setAlbumError(error instanceof Error ? error.message : 'Failed to load album');
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
      if (request === librarySongRequest.current && session === sessionRequest.current) setLibrarySongError(error instanceof Error ? error.message : 'Failed to load songs');
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
        setRandomError(error instanceof Error ? error.message : 'Failed to load random songs');
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
    setArtistLoading(false); setArtistError(failed ? 'Some album tracks failed to load. Reopen the artist to try again.' : '');
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

  const primaryNav = [{ id: 'home' as const, label: 'Home', icon: Home }, { id: 'search' as const, label: 'Search', icon: Search }];
  const libraryNav = [{ id: 'library' as const, label: 'Library', icon: Library }, { id: 'artists' as const, label: 'Artists', icon: Users }, { id: 'albums' as const, label: 'Albums', icon: AlbumIcon }, { id: 'playlists' as const, label: 'Playlists', icon: ListMusic }];
  const currentServerName = mode === 'demo' ? 'Demo mode' : serverLabel(connectedSettings || settings);
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
    {closePromptOpen && <div className="close-prompt-backdrop" role="presentation"><section className="close-prompt" role="dialog" aria-modal="true" aria-labelledby="close-prompt-title"><h2 id="close-prompt-title">Close Tenma Player</h2><p>Would you like to close the app or keep it running in the background?</p><label className="close-prompt-remember"><input type="checkbox" checked={rememberCloseChoice} onChange={(event) => setRememberCloseChoice(event.target.checked)} /><span>Remember my choice</span></label><div className="close-prompt-actions"><button className="secondary-button" onClick={() => setClosePromptOpen(false)}>Cancel</button><button className="secondary-button" onClick={() => resolveCloseChoice('background')}>Keep in background</button><button className="primary-button" onClick={() => resolveCloseChoice('quit')}>Quit</button></div></section></div>}
    <aside className={cn('sidebar', mobileNav && 'mobile-open')}>
      <div className="server-switcher" ref={serverSwitcherRef}>
        <button ref={serverButtonRef} className="server-switcher-button" aria-label={`Switch server: ${currentServerName}`} aria-expanded={serverMenuOpen} aria-controls="server-options" onClick={() => setServerMenuOpen((open) => !open)}><span className={cn('status-dot', isConnected && 'online')} /><span className="server-switcher-copy"><strong>{currentServerName}</strong><small>{isConnected ? 'Navidrome · Connected' : 'Demo mode'}</small></span><ChevronDown size={16} /></button>
        {serverMenuOpen && <div className="server-menu" id="server-options" aria-label="Server options">
          <p>Music server</p>
          {isConnected && <button className="server-option current" onClick={() => setServerMenuOpen(false)}><span className="status-dot online" /><span>{currentServerName}<small>Current connection</small></span><Check size={15} /></button>}
          <button className={cn('server-option', mode === 'demo' && 'current')} onClick={() => { if (mode !== 'demo') useDemo(); nav('home'); }}><Disc3 size={17} /><span>Demo mode<small>Connect a server to load your music</small></span>{mode === 'demo' && <Check size={15} />}</button>
          <button className="server-option server-add" onClick={openConnectionSettings}><Plus size={17} /><span>Add / switch server</span></button>
          <small className="server-menu-note">One server connection is supported. Switching requires authentication again.</small>
        </div>}
      </div>
      <nav className="sidebar-navigation" aria-label="Main navigation">
        <div className="nav-group">{primaryNav.map(renderNavItem)}</div>
        <div className="nav-group"><p className="nav-group-label">Library</p>{libraryNav.map(renderNavItem)}</div>
      </nav>
      <div className="sidebar-footer"><button className={cn('nav-item', page === 'settings' && 'active')} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => nav('settings')}><Settings size={18} /><span>Settings</span></button></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-drag-zone" data-tauri-drag-region aria-hidden="true" />
        <div className="topbar-left">
          <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
        </div>
        <div className="topbar-brand" aria-label="Tenma Player">Tenma Player</div>
        <div className="top-actions"><WindowControls /></div>
      </header>
      <div className="content-scroll">
        {availableUpdate && <section className="update-banner" aria-live="polite"><div className="update-banner-copy"><strong>Tenma Player update {availableUpdate.version}</strong><span>{updateStatus === 'downloading' ? `Downloading update… ${updateProgress}%` : updateError || 'An update is ready to download and install.'}</span></div>{updateStatus === 'downloading' ? <span className="update-progress" aria-label={`Download progress ${updateProgress}%`}><span style={{ width: `${updateProgress}%` }} /></span> : <><button className="primary-button compact" onClick={installUpdate}>Update now</button><button className="update-dismiss" aria-label="Remind me later" onClick={() => { void availableUpdate.close(); setAvailableUpdate(null); }}>Later</button></>}</section>}
        {message && <div className="toast-spacer" />}
        {message && <div className={cn('toast', message.type)}>{message.type === 'success' ? '✓' : '!'} {message.text}<button onClick={() => setMessage(null)}><X size={15} /></button></div>}
        <div key={page} className="content-page">
          {page === 'settings' ? <SettingsView key={connectionViewKey} settings={settings} setSettings={setSettings} connected={connectedSettings} password={password} setPassword={setPassword} rememberPassword={rememberPassword} setRememberPassword={setRememberPassword} connect={connect} loading={loading} useDemo={useDemo} disconnect={useDemo} rename={renameServer} preferences={preferences} setPreferences={setPreferences} updateVersion={availableUpdate?.version} updateStatus={updateStatus} updateProgress={updateProgress} updateError={updateError} updateMessage={updateMessage} checkForUpdate={() => { if (!isTauri()) { setUpdateError('Automatic updates are not available on the web. Use the Windows desktop app.'); setUpdateMessage(''); return; } setUpdateError(''); setUpdateMessage(''); setUpdateStatus('checking'); import('@tauri-apps/plugin-updater').then(({ check }) => check({ timeout: 15000 })).then((result) => { if (result) { setAvailableUpdate(result as AvailableUpdate); setUpdateMessage(''); } else setUpdateMessage('You are already running the latest version'); setUpdateStatus('idle'); }).catch((error: unknown) => { setUpdateStatus('error'); setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates'); }) }} installUpdate={installUpdate} /> : page === 'playlists' ? <PlaylistsView playlists={playlists} onOpen={openPlaylist} error={playlistsError} onRefresh={refreshPlaylists} loading={playlistsLoading} /> : page === 'playlist' ? <PlaylistDetailView playlist={selectedPlaylist} loading={playlistLoading} error={playlistError} onBack={() => moveHistory(-1)} onPlay={playSong} /> : page === 'album' ? <AlbumDetailView album={selectedAlbum} loading={albumLoading} error={albumError} onBack={() => moveHistory(-1)} onPlay={playSong} /> : page === 'artist' ? <ArtistDetailView artist={selectedArtist} loading={artistLoading} error={artistError} onBack={() => nav('artists')} onOpen={openAlbum} onPlay={playSong} /> : page === 'artists' ? <ArtistsView albums={albums} onOpen={openArtist} /> : page === 'albums' ? <AlbumsView albums={albums} error={albumsError} onOpen={openAlbum} /> : page === 'library' || page === 'search' ? <LibraryView albums={albums} albumsError={albumsError} playlists={playlists} playlistsError={playlistsError} songs={librarySongs} songPage={librarySongPage} songLoading={librarySongLoading} songError={librarySongError} hasNext={libraryHasNext} knownPageCount={libraryKnownPageCount} query={query} onQuery={setQuery} results={searchResults} searchLoading={loading} randomSongs={randomSongs} randomLoading={randomLoading} randomError={randomError} onRefreshRandom={refreshRandom} onArtist={openArtist} onOpen={openAlbum} onPlay={playSong} onPage={loadLibrarySongs} /> : <HomeView albums={recentAlbums.slice(0, 8)} mode={mode} loading={loading} onOpen={openAlbum} onConnect={() => nav('settings')} />}
        </div>
      </div>
    </main>
    <audio ref={audioRef} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setMessage({ type: 'error', text: 'Playback failed. Check your network or audio format.' }); }} onEnded={() => { setPlaying(false); if (preferences.autoNext) next(); }} />
    {!nowPlayingOpen && <Player track={currentTrack} playing={playing} currentTime={currentTime} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} onToggle={togglePlay} onPrevious={previous} onNext={next} onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} onVolume={changeVolume} onMute={toggleMute} onShuffle={() => setShuffle(!shuffle)} onRepeat={() => setRepeat(!repeat)} showQueue={showQueue} onQueue={() => setShowQueue(!showQueue)} onOpenNowPlaying={() => { setShowQueue(false); setNowPlayingOpen(true); }} />}
    {nowPlayingOpen && <NowPlayingView track={currentTrack} playing={playing} currentTime={currentTime} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} api={api} onClose={() => setNowPlayingOpen(false)} onToggle={togglePlay} onPrevious={previous} onNext={next} onSeek={(value) => { if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} onVolume={changeVolume} onMute={toggleMute} onShuffle={() => setShuffle(!shuffle)} onRepeat={() => setRepeat(!repeat)} onQueue={() => setShowQueue(!showQueue)} />}
    {showQueue && <section className="queue-panel" aria-label="Playback queue"><div className="group-title"><h2>Playback queue</h2><button className="icon-button" aria-label="Close queue" onClick={() => setShowQueue(false)}><X size={18} /></button></div>{queue.length ? queue.map((song, index) => <button key={`${song.id}-${index}`} className={cn('queue-track', index === currentIndex && 'control-active')} onClick={() => { if (index === currentIndex) togglePlay(); else setCurrentIndex(index); }}><span>{song.title}<small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span></button>) : <p>No tracks in the queue.</p>}</section>}

  </div>;
}

function HomeView({ albums, mode, loading, onOpen, onConnect }: { albums: Album[]; mode: AppMode; loading: boolean; onOpen: (album: Album) => void; onConnect: () => void }) {
  return <section className="home-view">
    <div className="section-heading"><h1>Recently added</h1><span>{albums.length} albums</span></div>
    {mode === 'demo' && <p className="connection-hint">This is demo mode. Connect Navidrome to load your music <button onClick={onConnect}>Connect Navidrome <ChevronRight size={13} /></button></p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={23} />Loading…</div> : albums.length ? <div className="album-grid">{albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div> : <EmptyPage title="No albums yet" description="Your music albums will appear here." icon={<AlbumIcon size={25} />} />}
  </section>;
}

function Pagination({ page, pageCount, onPage, hasNext = page < pageCount - 1 }: { page: number; pageCount: number; onPage: (page: number) => void; hasNext?: boolean }) {
  const safeCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(0, page), safeCount - 1);
  const windowSize = Math.min(5, safeCount);
  const start = safeCount <= 5 ? 0 : safePage <= 2 ? 0 : safePage >= safeCount - 3 ? safeCount - 5 : safePage - 2;
  const visible = Array.from({ length: windowSize }, (_, index) => start + index);
  return <nav className="pagination" aria-label="Pagination">
    <button className="pagination-button pagination-arrow" aria-label="Previous page" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}><ChevronLeft size={16} /><span>Previous</span></button>
    {visible.map((index) => <button key={index} className={cn('pagination-button', index === safePage && 'active')} aria-current={index === safePage ? 'page' : undefined} onClick={() => onPage(index)}>{index + 1}</button>)}
    <button className="pagination-button pagination-arrow" aria-label="Next page" disabled={!hasNext || safePage >= safeCount - 1 && !hasNext} onClick={() => onPage(safePage + 1)}><span>Next</span><ChevronRight size={16} /></button>
  </nav>;
}

function AlbumsView({ albums, error, onOpen }: { albums: Album[]; error: string; onOpen: (album: Album) => void }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(albums.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="albums-view"><div className="section-heading"><h1>Albums</h1><span>{albums.length} albums</span></div>{error ? <p className="inline-error">Failed to load all albums: {error}. Reconnect and try again.</p> : <p className="library-note">All albums in the current library</p>}{albums.length ? <><div className="album-grid">{albums.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title="No albums yet" description="Connect a music service to view your albums." icon={<AlbumIcon size={25} />} />}</section>;
}

function ArtistsView({ albums, onOpen }: { albums: Album[]; onOpen: (name: string) => void }) {
  const artists = Array.from(new Set(albums.map((album) => album.artist).filter(Boolean)));
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(artists.length / GRID_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="artists-view"><div className="section-heading"><h1>Artists</h1><span>{artists.length} artists</span></div><p className="library-note">Based on the albums currently loaded</p>{artists.length ? <><div className="artist-grid">{artists.slice(currentPage * GRID_PAGE_SIZE, (currentPage + 1) * GRID_PAGE_SIZE).map((artist) => {
    const artistAlbums = albums.filter((album) => album.artist === artist);
    return <button className="artist-item" key={artist} aria-label={`View artist ${artist}`} onClick={() => onOpen(artist)}><Cover src={artistAlbums[0]?.coverArt} alt={artist} className="artist-avatar" /><strong>{artist}</strong><small>{artistAlbums.length} albums</small></button>;
  })}</div><Pagination page={currentPage} pageCount={pageCount} onPage={setPage} /></> : <EmptyPage title="No artists yet" description="Artists will appear here after albums load." icon={<Users size={25} />} />}</section>;
}

function TrackTable({ songs, onPlay }: { songs: Song[]; onPlay: (song: Song, list?: Song[]) => void }) {
  return <div className="library-track-table">
    <div className="library-track-heading" aria-hidden="true"><span>#</span><span>Track</span><span className="track-artist">Artist</span><span className="track-album">Album</span><span className="song-duration">Duration</span><span /></div>
    {songs.map((song, index) => <button key={song.id} className="library-track-row" aria-label={`Play ${song.title} by ${song.artist}`} onClick={() => onPlay(song, songs)}>
      <span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="table-song"><Cover src={song.coverArt} alt={song.album} /><span className="song-main"><strong>{song.title}</strong><small>{song.artist}</small></span></span>
      <span className="track-artist">{song.artist}</span><span className="track-album">{song.album}</span><span className="song-duration">{formatTime(song.duration)}</span><Play size={15} />
    </button>)}
  </div>;
}

function RecommendCards({ songs, loading, error, onRefresh, onPlay }: { songs: Song[]; loading: boolean; error: string; onRefresh: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  return <><div className="section-heading"><h2>Recommended for you</h2><button className="secondary-button" disabled={loading} onClick={onRefresh}><Shuffle size={14} />Refresh</button></div>{error && <p className="inline-error">{error}</p>}{loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />Choosing tracks…</div> : songs.length ? <div className="recommend-grid">{songs.map((song) => <button className="recommend-card" key={song.id} onClick={() => onPlay(song, songs)}><Cover src={song.coverArt} alt={song.album} /><span className="recommend-copy"><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></span><span className="recommend-play"><Play size={15} fill="currentColor" /></span></button>)}</div> : <EmptyPage title="No recommendations" description="Refresh to try again, or search for something to play." icon={<Music2 size={25} />} />}</>;
}

function SearchResultsCards({ results, loading, onArtist, onOpen, onPlay }: { results: SearchResults; loading: boolean; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (loading) return <div className="loading-state"><LoaderCircle className="spin" size={25} />Searching…</div>;
  return <>{results.songs.length > 0 && <div className="result-group"><div className="group-title"><h2>Tracks</h2><span>{results.songs.length}</span></div><div className="search-result-grid">{results.songs.map((song) => <button className="search-result-card" key={song.id} onClick={() => onPlay(song, results.songs)}><Cover src={song.coverArt} alt={song.album} /><span className="recommend-copy"><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></span><Play size={15} /></button>)}</div></div>}{results.albums.length > 0 && <div className="result-group"><div className="group-title"><h2>Albums</h2><span>{results.albums.length}</span></div><div className="album-grid search-grid">{results.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div></div>}{results.artists.length > 0 && <div className="result-group"><div className="group-title"><h2>Artists</h2><span>{results.artists.length}</span></div><div className="artist-pills">{results.artists.map((artist) => <button key={artist.id} onClick={() => onArtist(artist.name)}><span className="artist-avatar">{artist.name[0]}</span>{artist.name}</button>)}</div></div>}{!results.songs.length && !results.albums.length && !results.artists.length && <EmptyPage title="No results found" description="Try a track, artist, or album name." icon={<Search size={25} />} />}</>;
}

function LibraryView({ albums, albumsError, playlists, playlistsError, songs, songPage, songLoading, songError, hasNext, knownPageCount, query, onQuery, results, searchLoading, randomSongs, randomLoading, randomError, onRefreshRandom, onArtist, onOpen, onPlay, onPage }: { albums: Album[]; albumsError: string; playlists: Playlist[]; playlistsError: string; songs: Song[]; songPage: number; songLoading: boolean; songError: string; hasNext: boolean; knownPageCount: number; query: string; onQuery: (query: string) => void; results: SearchResults; searchLoading: boolean; randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void; onPage: (page: number) => void }) {
  const songCount = indexedSongCount(albums);
  const hasSongCounts = albums.some((album) => album.songCount !== undefined || album.songs?.length !== undefined);
  const stats = [{ label: 'Tracks', count: albumsError || !hasSongCounts ? null : songCount, icon: Music2 }, { label: 'Albums', count: albumsError ? null : albums.length, icon: AlbumIcon }, { label: 'Artists', count: albumsError ? null : new Set(albums.map((album) => album.artist)).size, icon: Users }, { label: 'Playlists', count: playlistsError ? null : playlists.length, icon: ListMusic }];
  return <section className="library-view"><div className="page-heading"><h1>Library</h1><p>Search, browse, and play your music collection.</p></div>
    <div className="library-search"><Search size={21} /><input className="library-search-input" aria-label="Search tracks, albums, or artists" placeholder="Search tracks, albums, or artists…" value={query} onChange={(event) => onQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => onQuery('')}><X size={18} /></button>}</div>
    <div className="library-stats">{stats.map(({ label, count, icon: Icon }) => <div className="library-stat" key={label}><Icon size={21} /><span>{label}<strong>{count === null ? '—' : count.toLocaleString()}</strong></span></div>)}</div>
    {albumsError && <p className="inline-error">Failed to load all albums: {albumsError}. Reconnect and try again.</p>}{playlistsError && <p className="inline-error">{playlistsError}</p>}
    {query.trim() ? <><div className="section-heading"><h2>Search results</h2></div><SearchResultsCards results={results} loading={searchLoading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /></> : <><RecommendCards songs={randomSongs} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} /><div className="section-heading library-songs-heading"><h2>All tracks</h2><span>Page {songPage + 1}</span></div>{songError && <p className="inline-error">{songError} Recommendations are still available.</p>}{songLoading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />Loading tracks…</div> : songs.length ? <TrackTable songs={songs} onPlay={onPlay} /> : <EmptyPage title="No tracks yet" description="The current server returned no tracks." icon={<Music2 size={25} />} />}<Pagination page={songPage} pageCount={knownPageCount} hasNext={!songLoading && hasNext} onPage={onPage} /></>}
  </section>;
}

// Kept as a compatibility export for older integrations; the app routes search into LibraryView.
function SearchView({ query, onQuery, results, loading, randomSongs, randomLoading, randomError, onRefreshRandom, onArtist, onOpen, onPlay }: { query: string; onQuery: (query: string) => void; results: SearchResults; loading: boolean; randomSongs: Song[]; randomLoading: boolean; randomError: string; onRefreshRandom: () => void; onArtist: (name: string) => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  return <section className="search-view"><div className="search-hero"><Search size={21} /><input aria-label="Search tracks, albums, and artists" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search tracks, albums, or artists…" /></div>{query.trim() ? <SearchResultsCards results={results} loading={loading} onArtist={onArtist} onOpen={onOpen} onPlay={onPlay} /> : <RecommendCards songs={randomSongs} loading={randomLoading} error={randomError} onRefresh={onRefreshRandom} onPlay={onPlay} />}</section>;
}

function EmptyPage({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) { return <div className="empty-page"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p></div>; }

function DetailBack({ label = 'Back', onBack }: { label?: string; onBack: () => void }) {
  return <button className="detail-back" onClick={onBack}><ChevronLeft size={17} />{label}</button>;
}

function ArtistDetailView({ artist, loading, error, onBack, onOpen, onPlay }: { artist: ArtistDetail | null; loading: boolean; error: string; onBack: () => void; onOpen: (album: Album) => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!artist) return <section className="detail-page"><DetailBack label="Back to artist list" onBack={onBack} /></section>;
  return <section className="detail-page artist-detail"><DetailBack label="Back to artist list" onBack={onBack} />
    <div className="detail-header"><Cover src={artist.albums[0]?.coverArt} alt={artist.name} className="detail-cover artist-avatar" /><div className="detail-content"><p className="eyebrow">Artist</p><h1>{artist.name}</h1><p className="detail-meta">{artist.albums.length} albums · {loading ? 'Loading tracks…' : `${artist.songs.length} tracks`}</p><button className="primary-button" disabled={loading || !artist.songs.length} onClick={() => onPlay(artist.songs[0], artist.songs)}><Play size={16} fill="currentColor" />Play tracks</button></div></div>
    <div className="detail-section-heading"><h2>Albums</h2><span>{artist.albums.length}</span></div>
    {artist.albums.length ? <div className="album-grid">{artist.albums.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpen} />)}</div> : <p className="library-note">No albums by this artist are available in the current library.</p>}
    <div className="detail-section-heading"><h2>Tracks</h2><span>{artist.songs.length}</span></div>
    {error && <p className="inline-error">{error}</p>}
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />Loading artist tracks…</div> : artist.songs.length ? <TrackTable songs={artist.songs} onPlay={onPlay} /> : <EmptyPage title="No tracks yet" description="Open an album for details or try again later." icon={<Music2 size={25} />} />}
  </section>;
}

function AlbumDetailView({ album, loading, error, onBack, onPlay }: { album: Album | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!album) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title="Album not found" description="This album may have been removed." icon={<AlbumIcon size={25} />} /></section>;
  const songs = album.songs || [];
  return <section className="detail-page">
    <DetailBack label="Back to album list" onBack={onBack} />
    <div className="detail-header">
      <Cover src={album.coverArt} alt={album.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">Album</p><h1>{album.name}</h1><p className="detail-meta">{album.artist}{album.year ? ` · ${album.year}` : ''}{album.songCount || songs.length ? ` · ${album.songCount || songs.length} tracks` : ''}</p><button className="primary-button" disabled={loading || !songs.length} onClick={() => songs[0] && onPlay(songs[0], songs)}><Play size={16} fill="currentColor" />Play album</button></div>
    </div>
    <div className="detail-section-heading"><h2>Tracks</h2><span>{loading ? 'Loading…' : `${songs.length} tracks`}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />Loading album tracks…</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>Back</button></div> : songs.length ? <div className="detail-track-list">{songs.map((song, index) => <button className="detail-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, songs)}><span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span><span className="detail-track-main"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={16} /></button>)}</div> : <EmptyPage title="No tracks yet" description="This album has no playable tracks yet." icon={<Music2 size={25} />} />}
  </section>;
}

function PlaylistDetailView({ playlist, loading, error, onBack, onPlay }: { playlist: Playlist | null; loading: boolean; error: string; onBack: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  if (!playlist) return <section className="detail-page"><DetailBack onBack={onBack} /><EmptyPage title="Playlist not found" description="This playlist may have been removed." icon={<ListMusic size={25} />} /></section>;
  const songs = playlist.songs || [];
  return <section className="detail-page">
    <DetailBack label="Back to playlist list" onBack={onBack} />
    <div className="detail-header">
      <Cover src={playlist.coverArt} alt={playlist.name} className="detail-cover" />
      <div className="detail-content"><p className="eyebrow">Playlist · {playlist.public ? 'Public' : 'Private'}</p><h1>{playlist.name}</h1><p className="detail-meta">{playlist.owner || 'Current account'} · {playlist.songCount || songs.length} tracks · {formatTime(playlist.duration)}</p>{playlist.comment && <p className="detail-description">{playlist.comment}</p>}<button className="primary-button" disabled={loading || !songs.length} onClick={() => songs[0] && onPlay(songs[0], songs)}><Play size={16} fill="currentColor" />Play playlist</button></div>
    </div>
    <div className="detail-section-heading"><h2>Tracks</h2><span>{loading ? 'Loading…' : `${songs.length} tracks`}</span></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />Loading playlist tracks…</div> : error ? <div><p className="inline-error">{error}</p><button className="secondary-button" onClick={onBack}>Back</button></div> : songs.length ? <div className="detail-track-list">{songs.map((song, index) => <button className="detail-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, songs)}><span className="detail-track-number">{String(index + 1).padStart(2, '0')}</span><span className="detail-track-main"><strong>{song.title}</strong><small>{song.artist}{song.album ? ` · ${song.album}` : ''}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={16} /></button>)}</div> : <EmptyPage title="No tracks yet" description="This playlist has no playable tracks yet." icon={<ListMusic size={25} />} />}
  </section>;
}

function Player({ track, playing, currentTime, duration, volume, muted, shuffle, repeat, onToggle, onPrevious, onNext, onSeek, onVolume, onMute, onShuffle, onRepeat, showQueue, onQueue, onOpenNowPlaying }: { track?: PlayerTrack; playing: boolean; currentTime: number; duration: number; volume: number; muted: boolean; shuffle: boolean; repeat: boolean; onToggle: () => void; onPrevious: () => void; onNext: () => void; onSeek: (value: number) => void; onVolume: (value: number) => void; onMute: () => void; onShuffle: () => void; onRepeat: () => void; showQueue: boolean; onQueue: () => void; onOpenNowPlaying: () => void }) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : track?.duration || 0;
  const handleVolumeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    onVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05));
  };
  return <footer className="player">
    <button className="now-playing now-playing-button" disabled={!track} aria-label="Open now playing" onClick={onOpenNowPlaying}>{track ? <Cover src={track.coverArt} alt={track.album} className="player-art" /> : <div className="player-art player-placeholder"><Music2 size={22} /></div>}<div className="track-label"><strong>{track?.title || 'Not playing'}</strong><span>{track?.artist || 'Choose a track to play'}</span></div></button>
    <div className="player-center"><div className="player-controls">
      <button aria-label="Shuffle" aria-pressed={shuffle} className={cn(shuffle && 'control-active')} onClick={onShuffle}><Shuffle size={17} /></button>
      <button aria-label="Previous track" disabled={!track} onClick={onPrevious}><SkipBack size={19} fill="currentColor" /></button>
      <button className="play-button" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle} disabled={!track}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <button aria-label="Next track" disabled={!track} onClick={onNext}><SkipForward size={19} fill="currentColor" /></button>
      <button aria-label="Repeat" aria-pressed={repeat} className={cn(repeat && 'control-active')} onClick={onRepeat}><Repeat size={17} /></button>
    </div><div className="progress-row"><span>{formatTime(currentTime)}</span><input className="progress-range" aria-label="Playback progress" type="range" min="0" max={total} disabled={!track || !total} step="1" value={Math.min(currentTime, total)} style={{ '--range-progress': `${total ? currentTime / total * 100 : 0}%` } as React.CSSProperties} onChange={(e) => onSeek(Number(e.target.value))} /><span>{formatTime(total)}</span></div></div>
    <div className="player-extra" onWheel={handleVolumeWheel}><button className="volume-button" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} aria-pressed={muted || volume === 0} onClick={onMute}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="volume-range" aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties} onChange={(e) => onVolume(Number(e.target.value))} /><button aria-label="Playback queue" aria-pressed={showQueue} className={cn(showQueue && 'control-active')} onClick={onQueue}><ListMusic size={20} /></button></div>
  </footer>;
}

export default App;
