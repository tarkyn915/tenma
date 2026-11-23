import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import type { Playlist } from './types';
import { errorContent, resolveMessage, useI18n } from './i18n';
import type { MessageContent } from './i18n';

export function PlaylistEditor({ playlist, onSave, onDelete, onClose }: {
  playlist: Playlist;
  onSave: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(playlist.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageContent>('');
  const busy = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (confirmDelete) initialFocus.current?.focus();
    else dialog.current?.querySelector('input')?.focus();
  }, [confirmDelete]);
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await action(); }
    catch (failure) { setError(errorContent(failure, confirmDelete ? 'error.deletePlaylist' : 'error.renamePlaylist')); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy.current) onClose();
  }}>
    <section ref={dialog} className="create-playlist-dialog edit-playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-playlist-title" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!busy.current) { if (confirmDelete) setConfirmDelete(false); else onClose(); }
      }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="edit-playlist-title">{t(confirmDelete ? 'playlists.delete' : 'playlists.edit')}</h2>
      {confirmDelete ? <>
        <p>{t('playlists.deleteConfirm', { name: playlist.name })}</p>
        {error && <p className="inline-error" role="alert">{resolveMessage(error, t)}</p>}
        <div className="settings-actions">
          <button ref={initialFocus} type="button" className="secondary-button" disabled={pending} onClick={() => { setConfirmDelete(false); setError(''); }}>{t('close.cancel')}</button>
          <button type="button" className="secondary-button danger-button" disabled={pending} onClick={() => void run(onDelete)}>{pending ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{t('playlists.delete')}</button>
        </div>
      </> : <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && name.trim() !== playlist.name) void run(() => onSave(name.trim())); }}>
        <label className="settings-field">{t('playlists.nameLabel')}<input name="name" required maxLength={128} className="settings-input" disabled={pending} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {error && <p className="inline-error" role="alert">{resolveMessage(error, t)}</p>}
        <div className="settings-actions">
          <button type="button" className="text-button danger-button playlist-delete-button" disabled={pending} onClick={() => { setConfirmDelete(true); setError(''); }}><Trash2 size={15} />{t('playlists.delete')}</button>
          <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{t('close.cancel')}</button>
          <button type="submit" className="primary-button" disabled={pending || !name.trim() || name.trim() === playlist.name}>{pending && <LoaderCircle className="spin" size={16} />}{t('playlists.save')}</button>
        </div>
      </form>}
    </section>
  </div>;
}
