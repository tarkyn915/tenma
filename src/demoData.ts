import type { Album, Playlist, SearchResults, Song } from './types';

// Tenma starts with an empty demo library. Connect Navidrome to load real music.
export const demoSongs: Song[] = [];
export const demoAlbums: Album[] = [];
export const demoPlaylists: Playlist[] = [];

export const demoSearch = (_query: string): SearchResults => ({
  songs: [],
  albums: [],
  artists: []
});

// Kept as an explicit helper for callers that want to present an empty demo state.
export const emptyDemoSong = (): Song[] => [];
