export type AppMode = 'demo' | 'server';

export interface Artist {
  id: string;
  name: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  duration?: number;
  track?: number;
  coverArt?: string;
  streamUrl?: string;
}

export interface LyricLine {
  text: string;
  start?: number;
}

export interface LyricsResult {
  lines: LyricLine[];
  synced: boolean;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
  created?: string;
  songs?: Song[];
}

export interface Playlist {
  id: string;
  name: string;
  comment: string;
  owner: string;
  public: boolean;
  songCount: number;
  duration: number;
  coverArt?: string;
  songs?: Song[];
}

export interface SearchResults {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
}

export interface ConnectionSettings {
  serverName?: string;
  server: string;
  username: string;
}

export interface PlayerTrack extends Song {
  source: 'demo' | 'server';
}
