import { Disc3, ListMusic, LoaderCircle, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Playlist, Song } from './types';
import { coverFallback, formatTime } from './utils';

function PlaylistCover({ playlist }: { playlist: Playlist }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [playlist.coverArt]);
  return playlist.coverArt && !failed ? <img className="album-art" src={playlist.coverArt} alt={playlist.name} onError={() => setFailed(true)} /> : <div className="album-art cover-fallback" style={{ background: coverFallback(playlist.name) }}><Disc3 size={36} /></div>;
}

export function PlaylistsView({ playlists, onOpen, error, onRefresh, loading }: { playlists: Playlist[]; onOpen: (playlist: Playlist) => void; error?: string; onRefresh?: () => void; loading?: boolean }) {
  return <section className="playlists-view">
    <div className="section-heading"><h1>歌单</h1><span>{playlists.length} 个歌单 {onRefresh && <button className="secondary-button" disabled={loading} onClick={onRefresh}>{loading ? '同步中…' : '刷新'}</button>}</span></div>
    <p className="library-note">来自当前音乐库的歌单。在 Navidrome 中创建或修改歌单后，可在此刷新同步。</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />正在加载歌单…</div> : playlists.length ? <div className="album-grid">{playlists.map((playlist) => <button className="album-card" key={playlist.id} onClick={() => onOpen(playlist)}><div className="album-art-wrap"><PlaylistCover playlist={playlist} /><span className="play-overlay"><Play size={18} /></span></div><span className="album-name">{playlist.name}</span><span className="playlist-meta">{playlist.songCount} 首歌曲{playlist.owner && ` · ${playlist.owner}`}</span></button>)}</div> : <div className="empty-page"><ListMusic size={28} /><h2>暂无歌单</h2><p>当前账号没有可访问的歌单。</p></div>}
  </section>;
}

export function PlaylistModal({ playlist, loading, error, onClose, onPlay }: { playlist: Playlist; loading: boolean; error: string; onClose: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="album-modal" role="dialog" aria-modal="true" aria-label={`歌单：${playlist.name}`} onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" aria-label="关闭歌单" onClick={onClose}><X size={19} /></button><div className="modal-header"><div className="playlist-modal-art"><PlaylistCover playlist={playlist} /></div><div><p className="eyebrow">歌单 · {playlist.public ? '公开' : '私人'}</p><h2>{playlist.name}</h2><p>{playlist.owner} · {playlist.songCount} 首歌曲 · {formatTime(playlist.duration)}</p>{playlist.comment && <p>{playlist.comment}</p>}<button className="primary-button compact" disabled={loading || !playlist.songs?.length} onClick={() => playlist.songs?.[0] && onPlay(playlist.songs[0], playlist.songs)}><Play size={15} />播放歌单</button></div></div>
      <div className="modal-tracks">{loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} />加载曲目…</div> : error ? <p className="inline-error" role="alert">{error}</p> : playlist.songs?.length ? playlist.songs.map((song, index) => <button className="modal-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, playlist.songs)}><span>{index + 1}</span><span><strong>{song.title}</strong><small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={15} /></button>) : <p className="library-note">这个歌单还没有歌曲。</p>}</div>
    </section></div>;
}
