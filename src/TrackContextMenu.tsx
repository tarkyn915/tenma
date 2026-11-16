import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Album, ChevronRight, ListPlus, LoaderCircle, User } from 'lucide-react';
import { useI18n } from './i18n';
import type { Playlist, Song } from './types';

interface Props {
  song: Song;
  position: { x: number; y: number };
  playlists: Playlist[];
  adding: boolean;
  onAddToPlaylist?: (playlistId: string, song: Song) => void;
  onArtist?: (name: string, artistId?: string) => void;
  onAlbum?: (song: Song) => void;
  onClose: () => void;
}

export function TrackContextMenu({ song, position, playlists, adding, onAddToPlaylist, onArtist, onAlbum, onClose }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [style, setStyle] = useState({ left: position.x, top: position.y });
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const menu = root.current;
      if (!menu) return;
      const bounds = menu.getBoundingClientRect();
      setStyle({
        left: Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))
      });
      root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [position.x, position.y]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const close = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [onClose]);
  const go = (action?: () => void) => { onClose(); action?.(); };
  // Render in a portal: fixed positioning inside the page content is hijacked by the
  // animated .content-page ancestor (fill-mode both keeps a transform), which shifted
  // the menu by the content origin instead of the mouse position.
  return createPortal(<div ref={root} className="track-context-menu" role="menu" aria-label={t('menu.moreActions')} style={style} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <div className="track-context-title"><span>{song.title}</span><small>{song.artist}</small></div>
    <button type="button" role="menuitem" disabled={!onAddToPlaylist || !playlists.length || adding} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      {adding ? <LoaderCircle className="spin" size={16} /> : <ListPlus size={16} />}<span>{adding ? t('menu.adding') : t('menu.addToPlaylist')}</span><ChevronRight size={14} className={expanded ? 'expanded' : ''} />
    </button>
    {expanded && !!playlists.length && <div className="track-playlist-options" role="group" aria-label={t('common.playlists')}>
      {playlists.map((playlist) => <button type="button" role="menuitem" key={playlist.id} disabled={adding || !onAddToPlaylist} onClick={() => go(() => onAddToPlaylist?.(playlist.id, song))}>{playlist.name}</button>)}
    </div>}
    <button type="button" role="menuitem" disabled={!onArtist || !song.artist.trim()} onClick={() => go(() => onArtist?.(song.artist, song.artistId))}><User size={16} /><span>{t('menu.goToArtist')}</span></button>
    <button type="button" role="menuitem" disabled={!onAlbum || !song.album.trim()} onClick={() => go(() => onAlbum?.(song))}><Album size={16} /><span>{t('menu.goToAlbum')}</span></button>
  </div>, document.body);
}
