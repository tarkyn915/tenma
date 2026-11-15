import type { Album, Song } from './types';

export function groupArtists(albums: Album[]) {
  const groups = new Map<string, { key: string; name: string; id?: string; albums: Album[] }>();
  for (const album of albums) {
    if (!album.artist.trim()) continue;
    const key = album.artistId ? `id:${album.artistId}` : `name:${album.artist}`;
    const group = groups.get(key) || { key, name: album.artist, id: album.artistId, albums: [] };
    group.albums.push(album);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/** Resolve known albums by ID first; never guess between albums sharing a name. */
export function albumForSong(song: Song, albums: Album[], remote: boolean): Album | undefined {
  if (remote && song.albumId) {
    return albums.find((album) => album.id === song.albumId) || {
      id: song.albumId, name: song.album, artist: song.artist, artistId: song.artistId, coverArt: song.coverArt
    };
  }
  if (song.localPath) {
    const containing = albums.find((album) => album.songs?.some((entry) => entry.localPath === song.localPath));
    if (containing) return containing;
  }
  const named = albums.filter((album) => !!song.album && album.name === song.album);
  const sameArtist = named.filter((album) => album.artist === song.artist);
  if (sameArtist.length === 1) return sameArtist[0];
  return named.length === 1 ? named[0] : undefined;
}
