import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
globalThis.localStorage = { getItem: () => null };
const result = await build({ stdin: { contents: `${await readFile('src/App.tsx', 'utf8')}\nexport { LibraryView, ArtistDetailView };`, resolveDir: resolve('src'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, jsx: 'automatic' });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const { LibraryView, ArtistDetailView } = module.exports;
const noop = () => {};
const songs = [0,1].map((index) => ({ id:`song-${index}`, title:`Track ${index+1}`, artist:'Artist', artistId:'artist', album:'Album', albumId:'album', bitRate:[128,320][index], duration:180 }));
const albums = [{ id:'album', name:'Album', artist:'Artist', artistId:'artist', songCount:2, songs }];
const playlists = [{ id:'target', name:'Target', comment:'',owner:'Listener',public:false,songCount:0,duration:0 }];
const props = { onPlay:noop,onArtist:noop,onAlbum:noop,canOpenAlbum:()=>true,playlists,onAddToPlaylist:noop,addingSongId:'' };
const artist = {name:'Artist',albums,songs};
const library = renderToStaticMarkup(React.createElement(LibraryView,{albums,albumsError:'',playlists,playlistsError:'',songs,songPage:0,songLoading:false,songError:'',hasNext:false,knownPageCount:1,query:'',onQuery:noop,results:{songs:[],albums:[],artists:[]},searchLoading:false,randomSongs:[],randomLoading:false,randomError:'',onRefreshRandom:noop,onArtist:noop,onOpen:noop,onPlay:noop,onPage:noop,onAddToPlaylist:noop}));
const artistView = renderToStaticMarkup(React.createElement(ArtistDetailView,{artist,loading:false,error:'',onBack:noop,onOpen:noop,...props}));
const noPlaylistProps = { onPlay:noop,onArtist:noop,onAlbum:noop,canOpenAlbum:()=>true,playlists:[],onAddToPlaylist:noop };
const libraryWithoutPlaylists = renderToStaticMarkup(React.createElement(LibraryView,{albums,albumsError:'',playlists:[],playlistsError:'',songs,songPage:0,songLoading:false,songError:'',hasNext:false,knownPageCount:1,query:'',onQuery:noop,results:{songs:[],albums:[],artists:[]},searchLoading:false,randomSongs:[],randomLoading:false,randomError:'',onRefreshRandom:noop,onArtist:noop,onOpen:noop,onPlay:noop,onPage:noop,onAddToPlaylist:noop}));
for (const [name, html] of [['library', library], ['artist', artistView], ['library-no-playlists', libraryWithoutPlaylists]]) {
  assert.ok(html.includes('library-track-table with-menu with-bit-rate'), `${name}: missing table classes`);
  assert.ok(html.includes('detail-track-bit-rate'), `${name}: missing bit rate column`);
  assert.ok(html.includes('aria-label="Song actions"'), `${name}: missing context menu button`);
  assert.ok(html.includes('128 kbps'), `${name}: missing bit rate value`);
  assert.ok(html.includes('metadata-link'), `${name}: missing artist/album navigation links`);
}
assert.ok(library.includes('aria-label="View album Album"'), 'Library album names must link to album pages');
console.log('PASS: library and artist tables render bitrate column, context menu buttons and metadata links with and without playlists');
