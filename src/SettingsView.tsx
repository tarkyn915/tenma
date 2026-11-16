import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, Eye, FolderOpen, HardDrive, Info, LoaderCircle, Palette, PlayCircle, Radio, RefreshCw, Server, Settings2, SlidersHorizontal } from 'lucide-react';
import { useI18n } from './i18n';
import type { TranslationKey } from './i18n';
import type { AppMode, ConnectionSettings } from './types';

export type Page = 'home' | 'search' | 'library' | 'artists' | 'albums' | 'playlists' | 'settings' | 'album' | 'artist' | 'playlist';
export interface Preferences {
  autoNext: boolean;
  audioQuality: 'original' | 'high' | 'standard' | 'data-saver';
  defaultVolume: number;
  startPage: 'home' | 'library' | 'playlists';
  showArtists: boolean;
  showDurations: boolean;
  accent: 'purple' | 'blue';
  theme: 'dark' | 'gray';
}
export const loadPreferences = (): Preferences => {
  let value: Partial<Preferences> = {};
  try { value = JSON.parse(localStorage.getItem('northstar.preferences') || '{}') || {}; } catch { /* Restore defaults for invalid stored settings. */ }
  return {
    autoNext: typeof value.autoNext === 'boolean' ? value.autoNext : true,
    audioQuality: value.audioQuality === 'high' || value.audioQuality === 'standard' || value.audioQuality === 'data-saver' ? value.audioQuality : 'original',
    defaultVolume: typeof value.defaultVolume === 'number' && Number.isFinite(value.defaultVolume) ? Math.min(1, Math.max(0, value.defaultVolume)) : 0.78,
    startPage: value.startPage === 'library' || value.startPage === 'playlists' ? value.startPage : 'home',
    showArtists: typeof value.showArtists === 'boolean' ? value.showArtists : true,
    showDurations: typeof value.showDurations === 'boolean' ? value.showDurations : true,
    accent: value.accent === 'blue' ? 'blue' : 'purple',
    theme: value.theme === 'gray' ? 'gray' : 'dark'
  };
};
export const serverLabel = (settings: ConnectionSettings) => settings.serverName?.trim() || settings.server.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'Navidrome';

interface Props {
  settings: ConnectionSettings;
  setSettings: (settings: ConnectionSettings) => void;
  connected: ConnectionSettings | null;
  password: string;
  setPassword: (password: string) => void;
  rememberPassword: boolean;
  setRememberPassword: (remember: boolean) => void;
  connect: (event: React.FormEvent) => void;
  loading: boolean;
  mode: AppMode;
  useLocal: () => void;
  restoreRemote?: () => void;
  disconnect: () => void;
  localFolder: string;
  localLoading: boolean;
  localSongCount: number;
  chooseLocalFolder: () => void;
  rescanLocalLibrary: () => void;
  rename: (name: string) => void;
  preferences: Preferences;
  setPreferences: (value: Preferences) => void;
  updateVersion?: string;
  updateStatus?: 'idle' | 'checking' | 'downloading' | 'error';
  updateProgress?: number;
  updateError?: string;
  updateMessage?: string;
  checkForUpdate?: () => void;
  installUpdate?: () => void;
}

type SettingsSection = 'general' | 'connection' | 'appearance' | 'playback' | 'quality' | 'content' | 'about';

const sections: { id: SettingsSection; labelKey: TranslationKey; descriptionKey: TranslationKey; icon: typeof Radio }[] = [
  { id: 'general', labelKey: 'settings.general.label', descriptionKey: 'settings.general.description', icon: Settings2 },
  { id: 'connection', labelKey: 'settings.connection.label', descriptionKey: 'settings.connection.description', icon: Radio },
  { id: 'appearance', labelKey: 'settings.appearance.label', descriptionKey: 'settings.appearance.description', icon: Palette },
  { id: 'playback', labelKey: 'settings.playback.label', descriptionKey: 'settings.playback.description', icon: PlayCircle },
  { id: 'quality', labelKey: 'settings.quality.label', descriptionKey: 'settings.quality.description', icon: SlidersHorizontal },
  { id: 'content', labelKey: 'settings.content.label', descriptionKey: 'settings.content.description', icon: Eye },
  { id: 'about', labelKey: 'settings.about.label', descriptionKey: 'settings.about.description', icon: Info }
];

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><span className="setting-row-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span><span className="setting-row-control">{children}</span></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><input aria-label={label} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /></label>;
}

interface SelectOption { value: string; label: string }
function SettingSelect({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const selected = options.find((option) => option.value === value) || options[0];
  return <div className="settings-select" ref={root}>
    <button ref={trigger} type="button" className="settings-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span>{selected?.label}</span><ChevronDown size={15} />
    </button>
    {open && <div className="settings-select-menu" role="listbox" aria-label={label}>
      {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}><span>{option.label}</span>{option.value === value && <Check size={15} />}</button>)}
    </div>}
  </div>;
}

export function SettingsView({ settings, setSettings, connected, password, setPassword, rememberPassword, setRememberPassword, connect, loading, mode, useLocal, restoreRemote, disconnect, localFolder, localLoading, localSongCount, chooseLocalFolder, rescanLocalLibrary, rename, preferences, setPreferences, updateVersion, updateStatus = 'idle', updateProgress = 0, updateError, updateMessage, checkForUpdate, installUpdate }: Props) {
  const { language, setLanguage, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [connectionMode, setConnectionMode] = useState<AppMode>(mode);
  const [section, setSection] = useState<SettingsSection>('connection');
  const [displayedSection, setDisplayedSection] = useState<SettingsSection>('connection');
  const [sectionTransition, setSectionTransition] = useState<'idle' | 'leaving' | 'entering'>('idle');
  const sectionTimer = useRef<number | undefined>(undefined);
  useEffect(() => { setEditing(false); }, [connected]);
  useEffect(() => { setConnectionMode(mode); }, [mode]);
  useEffect(() => () => { if (sectionTimer.current !== undefined) window.clearTimeout(sectionTimer.current); }, []);
  const update = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => setPreferences({ ...preferences, [key]: value });
  const changeSection = (next: SettingsSection) => {
    if (next === section) return;
    if (sectionTimer.current !== undefined) window.clearTimeout(sectionTimer.current);
    setSection(next);
    setSectionTransition('leaving');
    sectionTimer.current = window.setTimeout(() => {
      setDisplayedSection(next);
      setSectionTransition('entering');
      sectionTimer.current = window.setTimeout(() => setSectionTransition('idle'), 240);
    }, 120);
  };

  return <section className="settings-view">
    <div className="page-heading"><h1>{t('settings.title')}</h1><p>{t('settings.description')}</p></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('settings.sections')}>
        {sections.map(({ id, labelKey, descriptionKey, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => changeSection(id)}><Icon size={18} /><span><strong>{t(labelKey)}</strong><small>{t(descriptionKey)}</small></span></button>)}
      </nav>
      <div className="settings-content">
        <div key={displayedSection} className={`settings-panel-transition ${sectionTransition}`}>
        {displayedSection === 'general' && <section className="settings-section" aria-labelledby="general-heading">
          <div className="settings-section-heading"><div><h2 id="general-heading">{t('settings.general.label')}</h2><p>{t('settings.general.subheading')}</p></div></div>
          <div className="settings-group">
            <SettingRow title={t('settings.general.language')} description={t('settings.general.languageDescription')}>
              <SettingSelect label={t('settings.general.language')} value={language} options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} onChange={(value) => setLanguage(value as typeof language)} />
            </SettingRow>
          </div>
        </section>}

        {displayedSection === 'connection' && <section className="settings-section" aria-labelledby="connection-heading">
          <div className="settings-section-heading"><div><h2 id="connection-heading">{t('settings.connection.label')}</h2><p>{t('settings.connection.subheading')}</p></div>{connectionMode === 'server' && connected && <span className="connection-status"><CheckCircle2 size={16} />{t('settings.connection.connected')}</span>}</div>
          <div className="library-mode-switch" role="group" aria-label={t('local.modeLabel')}>
            <button type="button" className={connectionMode === 'local' ? 'active' : ''} aria-pressed={connectionMode === 'local'} onClick={() => { setConnectionMode('local'); useLocal(); }}><HardDrive size={17} /><span>{t('server.localMode')}</span></button>
            <button type="button" className={connectionMode === 'server' ? 'active' : ''} aria-pressed={connectionMode === 'server'} onClick={() => { setConnectionMode('server'); if (mode !== 'server') restoreRemote?.(); }}><Server size={17} /><span>{t('server.remoteMode')}</span></button>
          </div>

          {connectionMode === 'local' && <div className="local-library-settings">
            <div className="local-library-summary"><span className="local-library-icon"><HardDrive size={22} /></span><div><strong>{localFolder || t('local.noFolder')}</strong><small>{localFolder ? t('local.folderSummary', { count: localSongCount }) : t('local.description')}</small></div></div>
            <div className="settings-actions">
              <button type="button" className="primary-button" disabled={localLoading} onClick={chooseLocalFolder}><FolderOpen size={16} />{localFolder ? t('local.changeFolder') : t('local.chooseFolder')}</button>
              {localFolder && <button type="button" className="secondary-button" disabled={localLoading} onClick={rescanLocalLibrary}>{localLoading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{localLoading ? t('local.scanning') : t('local.rescan')}</button>}
            </div>
            <p className="settings-footnote">{t('local.supportedFormats')}</p>
          </div>}

          {connectionMode === 'server' && <>
            {connected && <>
              <div className="connection-summary"><span className="status-dot online" /><div><strong>{t('settings.connection.connectedTo', { name: serverLabel(connected) })}</strong><small>{connected.server} · {t('settings.connection.account')}: {connected.username}</small></div></div>
              <div className="settings-group">
                <SettingRow title={t('settings.connection.serverName')} description={t('settings.connection.serverNameDescription')}><input className="settings-input inline-input" value={connected.serverName || ''} placeholder={serverLabel({ ...connected, serverName: '' })} onChange={(event) => rename(event.target.value)} /></SettingRow>
              </div>
              <div className="settings-group"><SettingRow title={t('settings.connection.savePassword')} description={t('settings.connection.savePasswordDescription')}><Toggle label={t('settings.connection.savePassword')} checked={rememberPassword} onChange={setRememberPassword} /></SettingRow></div>
              <div className="settings-actions"><button className="secondary-button" onClick={() => setEditing(!editing)}>{editing ? t('settings.connection.hide') : t('settings.connection.edit')}</button><button className="text-button danger-button" onClick={() => { disconnect(); setConnectionMode('local'); setEditing(false); }}>{t('settings.connection.disconnect')}</button></div>
            </>}
            {(!connected || editing) && <form className="settings-form" onSubmit={connect}>
              <div className="form-section-title"><Radio size={17} /><span>{connected ? t('settings.connection.update') : t('settings.connection.connect')}</span></div>
              <label className="settings-field">{t('settings.connection.serverName')} <span>{t('settings.connection.optional')}</span><input className="settings-input" value={settings.serverName || ''} onChange={(event) => setSettings({ ...settings, serverName: event.target.value })} placeholder={t('settings.connection.serverNamePlaceholder')} /></label>
              <label className="settings-field">{t('settings.connection.serverAddress')}<input required type="url" className="settings-input" value={settings.server} onChange={(event) => setSettings({ ...settings, server: event.target.value })} placeholder="https://music.example.com" /></label>
              <label className="settings-field">{t('settings.connection.username')}<input required autoComplete="username" className="settings-input" value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} placeholder={t('settings.connection.usernamePlaceholder')} /></label>
              <label className="settings-field">{t('settings.connection.password')}<input required type="password" autoComplete="current-password" className="settings-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('settings.connection.passwordPlaceholder')} /></label>
              <div className="remember-password-field"><Toggle label={t('settings.connection.savePassword')} checked={rememberPassword} onChange={setRememberPassword} /><span><strong>{t('settings.connection.savePassword')}</strong><small>{t('settings.connection.savePasswordShortDescription')}</small></span></div>
              <div className="settings-actions"><button className="primary-button" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} />{t('settings.connection.connecting')}</> : t('settings.connection.test')}</button></div>
              <p className="security-note">{t('settings.connection.securityNote')}</p>
            </form>}
            {!connected && <p className="settings-footnote">{t('settings.connection.footnote')}</p>}
          </>}
        </section>}

        {displayedSection === 'appearance' && <section className="settings-section" aria-labelledby="appearance-heading">
          <div className="settings-section-heading"><div><h2 id="appearance-heading">{t('settings.appearance.label')}</h2><p>{t('settings.appearance.subheading')}</p></div></div>
          <div className="settings-group">
            <SettingRow title={t('settings.appearance.theme')} description={t('settings.appearance.themeDescription')}><SettingSelect label={t('settings.appearance.theme')} value={preferences.theme} options={[{ value: 'dark', label: t('settings.appearance.dark') }, { value: 'gray', label: t('settings.appearance.gray') }]} onChange={(value) => update('theme', value as Preferences['theme'])} /></SettingRow>
            <SettingRow title={t('settings.appearance.accent')} description={t('settings.appearance.accentDescription')}><SettingSelect label={t('settings.appearance.accent')} value={preferences.accent} options={[{ value: 'purple', label: t('settings.appearance.purple') }, { value: 'blue', label: t('settings.appearance.blue') }]} onChange={(value) => update('accent', value as Preferences['accent'])} /></SettingRow>
            <SettingRow title={t('settings.appearance.startPage')} description={t('settings.appearance.startPageDescription')}><SettingSelect label={t('settings.appearance.startPage')} value={preferences.startPage} options={[{ value: 'home', label: t('nav.home') }, { value: 'library', label: t('nav.library') }, { value: 'playlists', label: t('common.playlists') }]} onChange={(value) => update('startPage', value as Preferences['startPage'])} /></SettingRow>
          </div>
        </section>}

        {displayedSection === 'playback' && <section className="settings-section" aria-labelledby="playback-heading">
          <div className="settings-section-heading"><div><h2 id="playback-heading">{t('settings.playback.label')}</h2><p>{t('settings.playback.subheading')}</p></div></div>
          <div className="settings-group"><SettingRow title={t('settings.playback.autoNext')} description={t('settings.playback.autoNextDescription')}><Toggle label={t('settings.playback.autoNext')} checked={preferences.autoNext} onChange={(value) => update('autoNext', value)} /></SettingRow><SettingRow title={t('settings.playback.defaultVolume')} description={t('settings.playback.defaultVolumeDescription')}><span className="volume-setting"><input aria-label={t('settings.playback.defaultVolume')} type="range" min="0" max="1" step="0.01" value={preferences.defaultVolume} onChange={(event) => update('defaultVolume', Number(event.target.value))} /><output>{Math.round(preferences.defaultVolume * 100)}%</output></span></SettingRow></div>
        </section>}

        {displayedSection === 'quality' && <section className="settings-section" aria-labelledby="quality-heading">
          <div className="settings-section-heading"><div><h2 id="quality-heading">{t('settings.quality.label')}</h2><p>{t('settings.quality.subheading')}</p></div></div>
          <div className="settings-group"><SettingRow title={t('settings.quality.audio')} description={t('settings.quality.audioDescription')}><SettingSelect label={t('settings.quality.audio')} value={preferences.audioQuality} options={[{ value: 'original', label: t('settings.quality.original') }, { value: 'high', label: t('settings.quality.high') }, { value: 'standard', label: t('settings.quality.standard') }, { value: 'data-saver', label: t('settings.quality.dataSaver') }]} onChange={(value) => update('audioQuality', value as Preferences['audioQuality'])} /></SettingRow></div>
          <p className="settings-footnote">{t('settings.quality.footnote')}</p>
        </section>}

        {displayedSection === 'content' && <section className="settings-section" aria-labelledby="content-heading">
          <div className="settings-section-heading"><div><h2 id="content-heading">{t('settings.content.label')}</h2><p>{t('settings.content.subheading')}</p></div></div>
          <div className="settings-group"><SettingRow title={t('settings.content.showArtists')} description={t('settings.content.showArtistsDescription')}><Toggle label={t('settings.content.showArtists')} checked={preferences.showArtists} onChange={(value) => update('showArtists', value)} /></SettingRow><SettingRow title={t('settings.content.showDurations')} description={t('settings.content.showDurationsDescription')}><Toggle label={t('settings.content.showDurations')} checked={preferences.showDurations} onChange={(value) => update('showDurations', value)} /></SettingRow></div>
        </section>}

        {displayedSection === 'about' && <section className="settings-section" aria-labelledby="about-heading">
          <div className="settings-section-heading"><div><h2 id="about-heading">{t('settings.about.label')}</h2><p>{t('settings.about.subheading')}</p></div></div>
          <div className="about-brand"><span className="about-brand-mark"><img src="/icon.png" alt="" width="44" height="44" /></span><div><strong>Tenma Player</strong><small>{t('settings.about.tagline')}</small></div></div>
          <div className="about-list"><div><span>{t('settings.about.version')}</span><strong>0.1.4</strong></div><div><span>{t('settings.about.musicService')}</span><strong>Navidrome / Subsonic API</strong></div><div><span>{t('settings.about.currentConnection')}</span><strong>{mode === 'server' && connected ? serverLabel(connected) : localFolder || t('settings.about.localLibrary')}</strong></div></div>
          <div className="settings-group update-settings-group"><SettingRow title={t('settings.about.updates')} description={updateError || updateMessage || (updateVersion ? t('settings.about.newVersion', { version: updateVersion }) : t('settings.about.updateDescription'))}><span className="update-settings-control">{updateStatus === 'checking' && <span className="update-checking"><LoaderCircle className="spin" size={15} />{t('settings.about.checking')}</span>}{updateStatus === 'downloading' && <span className="update-checking">{t('settings.about.downloading', { progress: updateProgress })}</span>}{updateStatus !== 'checking' && updateStatus !== 'downloading' && updateVersion && <button className="primary-button compact" onClick={installUpdate}>{t('update.now')}</button>}<button className="secondary-button compact" disabled={updateStatus === 'checking' || updateStatus === 'downloading'} onClick={checkForUpdate}>{t('settings.about.check')}</button></span></SettingRow></div>
        </section>}
        </div>
      </div>
    </div>
  </section>;
}
