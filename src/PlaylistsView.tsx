import { Disc3, ListMusic, LoaderCircle, Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Playlist, Song } from './types';
import { coverFallback, formatTime } from './utils';
import { useI18n } from './i18n';
import { BalancedGrid } from './BalancedGrid';

function PlaylistCover({ playlist }: { playlist: Playlist }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [playlist.coverArt]);
  return playlist.coverArt && !failed ? <img className="album-art" src={playlist.coverArt} alt={playlist.name} onError={() => setFailed(true)} /> : <div className="album-art cover-fallback" style={{ background: coverFallback(playlist.name) }}><Disc3 size={36} /></div>;
}

export function PlaylistsView({ playlists, onOpen, error, onRefresh, loading }: { playlists: Playlist[]; onOpen: (playlist: Playlist) => void; error?: string; onRefresh?: () => void; loading?: boolean }) {
  const { t } = useI18n();
  return <section className="playlists-view">
    <div className="section-heading"><h1>{t('common.playlists')}</h1><span>{t('count.playlists', { count: playlists.length })} {onRefresh && <button className="secondary-button" disabled={loading} onClick={onRefresh}>{loading ? t('playlists.syncing') : t('common.refresh')}</button>}</span></div>
    <p className="library-note">{t('playlists.description')}</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} />{t('playlists.loading')}</div> : playlists.length ? <BalancedGrid className="album-grid" itemCount={playlists.length}>{playlists.map((playlist) => <button className="album-card" key={playlist.id} onClick={() => onOpen(playlist)}><div className="album-art-wrap"><PlaylistCover playlist={playlist} /><span className="play-overlay"><Play size={18} /></span></div><span className="album-name">{playlist.name}</span><span className="playlist-meta">{t('count.tracks', { count: playlist.songCount })}{playlist.owner && ` · ${playlist.owner}`}</span></button>)}</BalancedGrid> : <div className="empty-page"><ListMusic size={28} /><h2>{t('playlists.empty')}</h2><p>{t('playlists.emptyDescription')}</p></div>}
  </section>;
}

export function PlaylistModal({ playlist, loading, error, onClose, onPlay }: { playlist: Playlist; loading: boolean; error: string; onClose: () => void; onPlay: (song: Song, list?: Song[]) => void }) {
  const { t } = useI18n();
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="album-modal" role="dialog" aria-modal="true" aria-label={t('playlists.dialogLabel', { name: playlist.name })} onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" aria-label={t('playlists.close')} onClick={onClose}><X size={19} /></button><div className="modal-header"><div className="playlist-modal-art"><PlaylistCover playlist={playlist} /></div><div><p className="eyebrow">{t('common.playlist')} · {playlist.public ? t('common.public') : t('common.private')}</p><h2>{playlist.name}</h2><p>{playlist.owner} · {t('count.tracks', { count: playlist.songCount })} · {formatTime(playlist.duration)}</p>{playlist.comment && <p>{playlist.comment}</p>}<button className="primary-button compact" disabled={loading || !playlist.songs?.length} onClick={() => playlist.songs?.[0] && onPlay(playlist.songs[0], playlist.songs)}><Play size={15} />{t('detail.playPlaylist')}</button></div></div>
      <div className="modal-tracks">{loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} />{t('library.loadingTracks')}</div> : error ? <p className="inline-error" role="alert">{error}</p> : playlist.songs?.length ? playlist.songs.map((song, index) => <button className="modal-track" key={`${song.id}-${index}`} onClick={() => onPlay(song, playlist.songs)}><span>{index + 1}</span><span><strong>{song.title}</strong><small>{song.artist}</small></span><span className="song-duration">{formatTime(song.duration)}</span><Play size={15} /></button>) : <p className="library-note">{t('playlists.noTracks')}</p>}</div>
    </section></div>;
}
