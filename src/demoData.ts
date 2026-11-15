import type { Song, SearchResults } from './types';
import { emptyLocalSongs } from './localLibrary';

/** @deprecated Tenma now uses Local mode. These aliases remain only for older integrations. */
export { emptyLocalAlbums as demoAlbums, emptyLocalPlaylists as demoPlaylists, emptyLocalSongs as demoSongs } from './localLibrary';

/** @deprecated Use the current local song state instead. */
export const emptyDemoSong = (): Song[] => emptyLocalSongs;

/** @deprecated Use searchLocalLibrary with the current local songs instead. */
export const demoSearch = (_query: string): SearchResults => ({ songs: [], albums: [], artists: [] });
