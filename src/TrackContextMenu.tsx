import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Album, ChevronRight, ListPlus, LoaderCircle, Trash2, User } from 'lucide-react';
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
  onRemoveFromPlaylist?: () => void;
  removing?: boolean;
  onClose: () => void;
}

export function TrackContextMenu({ song, position, playlists, adding, onAddToPlaylist, onArtist, onAlbum, onRemoveFromPlaylist, removing, onClose }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [style, setStyle] = useState<{ left: number; top: number; maxHeight?: number }>({ left: position.x, top: position.y });
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const menu = root.current;
      if (!menu) return;
      const bounds = menu.getBoundingClientRect();
      // The menu is portaled to body and must be allowed to overlap the player
      // bar. Keeping the player out of the safe area made the lower actions
      // unreachable when the playlist submenu was expanded.
      const safeBottom = window.innerHeight - 8;
      const maxHeight = Math.max(96, window.innerHeight - 16);
      setStyle({
        left: Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(position.y, safeBottom - Math.min(bounds.height, maxHeight))),
        maxHeight
      });
      root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [position.x, position.y, expanded, onRemoveFromPlaylist, removing]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const close = (event: Event) => {
      // Expanding the playlist submenu can scroll its own options list. Do not
      // interpret that internal scroll as a page scroll and close the menu.
      if (root.current?.contains(event.target as Node)) return;
      onClose();
    };
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
    {onRemoveFromPlaylist && <button type="button" role="menuitem" disabled={!!removing} onClick={() => go(onRemoveFromPlaylist)}>{removing ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}<span>{removing ? t('menu.removing') : t('menu.removeFromPlaylist')}</span></button>}
  </div>, document.body);
}
