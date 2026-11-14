import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, Info, LoaderCircle, Palette, PlayCircle, Radio, SlidersHorizontal } from 'lucide-react';
import type { ConnectionSettings } from './types';

export type Page = 'home' | 'search' | 'library' | 'artists' | 'albums' | 'playlists' | 'settings' | 'album' | 'artist' | 'playlist';
export interface Preferences {
  autoNext: boolean;
  audioQuality: 'original' | 'high' | 'standard' | 'data-saver';
  defaultVolume: number;
  startPage: 'home' | 'library' | 'playlists';
  showArtists: boolean;
  showDurations: boolean;
  accent: 'purple' | 'blue';
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
    accent: value.accent === 'blue' ? 'blue' : 'purple'
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
  useDemo: () => void;
  disconnect: () => void;
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

type SettingsSection = 'connection' | 'appearance' | 'playback' | 'quality' | 'content' | 'about';

const sections: { id: SettingsSection; label: string; description: string; icon: typeof Radio }[] = [
  { id: 'connection', label: 'Connection', description: 'Navidrome server', icon: Radio },
  { id: 'appearance', label: 'Appearance', description: 'Interface and startup', icon: Palette },
  { id: 'playback', label: 'Playback', description: 'Playback and volume', icon: PlayCircle },
  { id: 'quality', label: 'Quality', description: 'Quality and data usage', icon: SlidersHorizontal },
  { id: 'content', label: 'Content', description: 'List display options', icon: Eye },
  { id: 'about', label: 'About', description: 'About Tenma Player', icon: Info }
];

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><span className="setting-row-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span><span className="setting-row-control">{children}</span></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><input aria-label={label} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /></label>;
}

export function SettingsView({ settings, setSettings, connected, password, setPassword, rememberPassword, setRememberPassword, connect, loading, useDemo, disconnect, rename, preferences, setPreferences, updateVersion, updateStatus = 'idle', updateProgress = 0, updateError, updateMessage, checkForUpdate, installUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<SettingsSection>('connection');
  const [displayedSection, setDisplayedSection] = useState<SettingsSection>('connection');
  const [sectionTransition, setSectionTransition] = useState<'idle' | 'leaving' | 'entering'>('idle');
  const sectionTimer = useRef<number | undefined>(undefined);
  useEffect(() => { setEditing(false); }, [connected]);
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
    <div className="page-heading"><h1>Settings</h1><p>Manage your music service and everyday playback preferences. Settings are saved in this browser.</p></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {sections.map(({ id, label, description, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => changeSection(id)}><Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span></button>)}
      </nav>
      <div className="settings-content">
        <div key={displayedSection} className={`settings-panel-transition ${sectionTransition}`}>
        {displayedSection === 'connection' && <section className="settings-section" aria-labelledby="connection-heading">
          <div className="settings-section-heading"><div><h2 id="connection-heading">Connection</h2><p>Connect to your Navidrome music service.</p></div>{connected && <span className="connection-status"><CheckCircle2 size={16} />Connected</span>}</div>
          {connected && <>
            <div className="connection-summary"><span className="status-dot online" /><div><strong>Connected to {serverLabel(connected)}</strong><small>{connected.server} · Account: {connected.username}</small></div></div>
            <div className="settings-group">
              <SettingRow title="Server name" description="Used to identify this library in the sidebar and player"><input className="settings-input inline-input" value={connected.serverName || ''} placeholder={serverLabel({ ...connected, serverName: '' })} onChange={(event) => rename(event.target.value)} /></SettingRow>
            </div>
            <div className="settings-group"><SettingRow title="Save password on this device" description="Saved locally in this browser. Avoid this on shared computers. A future desktop version may use Windows Credential Manager."><Toggle label="Save password on this device" checked={rememberPassword} onChange={setRememberPassword} /></SettingRow></div>
            <div className="settings-actions"><button className="secondary-button" onClick={() => setEditing(!editing)}>{editing ? 'Hide connection details' : 'Edit connection details'}</button><button className="text-button danger-button" onClick={() => { disconnect(); setEditing(false); }}>Disconnect / switch server</button></div>
          </>}
          {(!connected || editing) && <form className="settings-form" onSubmit={connect}>
            <div className="form-section-title"><Radio size={17} /><span>{connected ? 'Update server connection' : 'Connect to Navidrome'}</span></div>
            <label className="settings-field">Server name <span>Optional</span><input className="settings-input" value={settings.serverName || ''} onChange={(event) => setSettings({ ...settings, serverName: event.target.value })} placeholder="e.g. Home music library" /></label>
            <label className="settings-field">Server address<input required type="url" className="settings-input" value={settings.server} onChange={(event) => setSettings({ ...settings, server: event.target.value })} placeholder="https://music.example.com" /></label>
            <label className="settings-field">Username<input required autoComplete="username" className="settings-input" value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} placeholder="Your username" /></label>
            <label className="settings-field">Password<input required type="password" autoComplete="current-password" className="settings-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
            <div className="remember-password-field"><Toggle label="Save password on this device" checked={rememberPassword} onChange={setRememberPassword} /><span><strong>Save password on this device</strong><small>Saved locally in this browser. Avoid this on shared computers.</small></span></div>
            <div className="settings-actions"><button className="primary-button" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} />Connecting…</> : 'Test and connect'}</button><button type="button" className="secondary-button" disabled={loading} onClick={useDemo}>Use demo mode</button></div>
            <p className="security-note">Uses Subsonic token authentication. Saved passwords use this browser's local storage, not secure credential storage. HTTPS is recommended.</p>
          </form>}
          {!connected && <p className="settings-footnote">Not connected to a music service yet? Explore Tenma Player in demo mode.</p>}
        </section>}

        {displayedSection === 'appearance' && <section className="settings-section" aria-labelledby="appearance-heading">
          <div className="settings-section-heading"><div><h2 id="appearance-heading">Appearance</h2><p>Adjust the interface accent and the page shown at startup.</p></div></div>
          <div className="settings-group"><SettingRow title="Theme" description="This version uses a clean dark interface"><span className="settings-value">Dark</span></SettingRow><SettingRow title="Accent color" description="Used for buttons, selected states, and playback progress"><select aria-label="Accent color" value={preferences.accent} onChange={(event) => update('accent', event.target.value as Preferences['accent'])}><option value="purple">Soft purple</option><option value="blue">Misty blue</option></select></SettingRow><SettingRow title="Open on startup" description="Applied the next time you open or refresh the app"><select aria-label="Open on startup" value={preferences.startPage} onChange={(event) => update('startPage', event.target.value as Preferences['startPage'])}><option value="home">Home</option><option value="library">Library</option><option value="playlists">Playlists</option></select></SettingRow></div>
        </section>}

        {displayedSection === 'playback' && <section className="settings-section" aria-labelledby="playback-heading">
          <div className="settings-section-heading"><div><h2 id="playback-heading">Playback</h2><p>Control what happens when a song ends and set the default volume.</p></div></div>
          <div className="settings-group"><SettingRow title="Auto-play next song" description="When off, playback stops when the current song ends"><Toggle label="Auto-play next song" checked={preferences.autoNext} onChange={(value) => update('autoNext', value)} /></SettingRow><SettingRow title="Default volume" description="Applied immediately and used at the next startup"><span className="volume-setting"><input aria-label="Default volume" type="range" min="0" max="1" step="0.01" value={preferences.defaultVolume} onChange={(event) => update('defaultVolume', Number(event.target.value))} /><output>{Math.round(preferences.defaultVolume * 100)}%</output></span></SettingRow></div>
        </section>}

        {displayedSection === 'quality' && <section className="settings-section" aria-labelledby="quality-heading">
          <div className="settings-section-heading"><div><h2 id="quality-heading">Quality</h2><p>Set your audio quality and data usage preference.</p></div></div>
          <div className="settings-group"><SettingRow title="Audio quality" description="Original quality preserves the source; lower quality uses less data"><select aria-label="Audio quality" value={preferences.audioQuality} onChange={(event) => update('audioQuality', event.target.value as Preferences['audioQuality'])}><option value="original">Original</option><option value="high">High</option><option value="standard">Standard</option><option value="data-saver">Data saver</option></select></SettingRow></div>
          <p className="settings-footnote">The preference is saved, but the available quality depends on Navidrome. This version does not yet apply it to stream transcoding parameters.</p>
        </section>}

        {displayedSection === 'content' && <section className="settings-section" aria-labelledby="content-heading">
          <div className="settings-section-heading"><div><h2 id="content-heading">Content</h2><p>Choose which information appears in song lists.</p></div></div>
          <div className="settings-group"><SettingRow title="Show album artists" description="Show the artist name below album cards"><Toggle label="Show album artists" checked={preferences.showArtists} onChange={(value) => update('showArtists', value)} /></SettingRow><SettingRow title="Show song durations" description="Applies to song lists, detail pages, and the queue"><Toggle label="Show song durations" checked={preferences.showDurations} onChange={(value) => update('showDurations', value)} /></SettingRow></div>
        </section>}

        {displayedSection === 'about' && <section className="settings-section" aria-labelledby="about-heading">
          <div className="settings-section-heading"><div><h2 id="about-heading">About</h2><p>About Tenma Player.</p></div></div>
          <div className="about-brand"><span className="about-brand-mark"><Radio size={22} /></span><div><strong>Tenma Player</strong><small>A clean player for your personal music library</small></div></div>
          <div className="about-list"><div><span>Version</span><strong>0.1.3</strong></div><div><span>Music service</span><strong>Navidrome / Subsonic API</strong></div><div><span>Current connection</span><strong>{connected ? serverLabel(connected) : 'Demo library'}</strong></div></div>
          <div className="settings-group update-settings-group"><SettingRow title="Updates" description={updateError || updateMessage || (updateVersion ? `New version ${updateVersion} available` : 'Checks GitHub Releases at startup. You can also check manually.')}><span className="update-settings-control">{updateStatus === 'checking' && <span className="update-checking"><LoaderCircle className="spin" size={15} />Checking…</span>}{updateStatus === 'downloading' && <span className="update-checking">Downloading {updateProgress}%</span>}{updateStatus !== 'checking' && updateStatus !== 'downloading' && updateVersion && <button className="primary-button compact" onClick={installUpdate}>Update now</button>}<button className="secondary-button compact" disabled={updateStatus === 'checking' || updateStatus === 'downloading'} onClick={checkForUpdate}>Check for updates</button></span></SettingRow></div>
        </section>}
        </div>
      </div>
    </div>
  </section>;
}
