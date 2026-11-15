import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Album, Artist, Playlist, SearchResults, Song } from './types';

interface LocalSongPayload {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  track?: number;
  bitRate?: number;
  path: string;
  coverPath?: string;
}

interface LocalLibraryPayload {
  folder: string;
  songs: LocalSongPayload[];
}

export interface LocalLibrary {
  folder: string;
  songs: Song[];
}

export const emptyLocalSongs: Song[] = [];
export const emptyLocalAlbums: Album[] = [];
export const emptyLocalPlaylists: Playlist[] = [];

export async function pickLocalLibraryFolder(title: string): Promise<string | null> {
  return invoke<string | null>('pick_local_library_folder', { title });
}

export async function scanLocalLibrary(folder: string): Promise<LocalLibrary> {
  const result = await invoke<LocalLibraryPayload>('scan_local_library', { folder });
  return {
    folder: result.folder,
    songs: result.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      track: song.track,
      bitRate: song.bitRate,
      localPath: song.path,
      streamUrl: convertFileSrc(song.path),
      coverArt: song.coverPath ? convertFileSrc(song.coverPath) : undefined
    }))
  };
}

export function localAlbumsFromSongs(songs: Song[]): Album[] {
  const albums = new Map<string, Album>();
  for (const song of songs) {
    const key = `${song.album}\0${song.artist}`;
    let album = albums.get(key);
    if (!album) {
      album = {
        id: `local-album-${encodeURIComponent(JSON.stringify([song.album, song.artist]))}`,
        name: song.album,
        artist: song.artist,
        artistId: song.artist,
        coverArt: song.coverArt,
        songCount: 0,
        songs: []
      };
      albums.set(key, album);
    }
    album.songs!.push({ ...song, albumId: album.id, artistId: song.artist });
    album.songCount = album.songs!.length;
    album.coverArt ||= song.coverArt;
  }
  return [...albums.values()];
}

export function searchLocalLibrary(songs: Song[], query: string): SearchResults {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return { songs: [], albums: [], artists: [] };
  const matches = (value: string) => value.toLocaleLowerCase().includes(normalized);
  const matchingSongs = songs.filter((song) => matches(song.title) || matches(song.artist) || matches(song.album));
  const albums = localAlbumsFromSongs(songs).filter((album) => matches(album.name) || matches(album.artist) || album.songs?.some((song) => matches(song.title)));
  const artistNames = [...new Set(matchingSongs.map((song) => song.artist).filter(Boolean))];
  const artists: Artist[] = artistNames.map((name) => ({ id: name, name }));
  return { songs: matchingSongs.slice(0, 30), albums: albums.slice(0, 20), artists: artists.slice(0, 20) };
}
