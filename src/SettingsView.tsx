import { useEffect, useState } from 'react';
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
}

type SettingsSection = 'connection' | 'appearance' | 'playback' | 'quality' | 'content' | 'about';

const sections: { id: SettingsSection; label: string; description: string; icon: typeof Radio }[] = [
  { id: 'connection', label: '连接', description: 'Navidrome 服务器', icon: Radio },
  { id: 'appearance', label: '外观', description: '界面与启动页', icon: Palette },
  { id: 'playback', label: '播放', description: '播放行为与音量', icon: PlayCircle },
  { id: 'quality', label: '音质', description: '音质与流量偏好', icon: SlidersHorizontal },
  { id: 'content', label: '内容显示', description: '列表显示方式', icon: Eye },
  { id: 'about', label: '关于', description: 'Tenma 信息', icon: Info }
];

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><span className="setting-row-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span><span className="setting-row-control">{children}</span></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><input aria-label={label} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /></label>;
}

export function SettingsView({ settings, setSettings, connected, password, setPassword, rememberPassword, setRememberPassword, connect, loading, useDemo, disconnect, rename, preferences, setPreferences }: Props) {
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<SettingsSection>('connection');
  useEffect(() => { setEditing(false); }, [connected]);
  const update = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => setPreferences({ ...preferences, [key]: value });

  return <section className="settings-view">
    <div className="page-heading"><h1>设置</h1><p>管理音乐服务与日常播放偏好，设置会保存在此浏览器。</p></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {sections.map(({ id, label, description, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon size={18} /><span><strong>{label}</strong><small>{description}</small></span></button>)}
      </nav>
      <div className="settings-content">
        <div key={section} className="settings-panel-transition">
        {section === 'connection' && <section className="settings-section" aria-labelledby="connection-heading">
          <div className="settings-section-heading"><div><h2 id="connection-heading">连接</h2><p>连接到你的 Navidrome 音乐服务。</p></div>{connected && <span className="connection-status"><CheckCircle2 size={16} />已连接</span>}</div>
          {connected && <>
            <div className="connection-summary"><span className="status-dot online" /><div><strong>已连接到 {serverLabel(connected)}</strong><small>{connected.server} · 当前账号：{connected.username}</small></div></div>
            <div className="settings-group">
              <SettingRow title="服务器名称" description="用于在侧边栏和播放器中识别此音乐库"><input className="settings-input inline-input" value={connected.serverName || ''} placeholder={serverLabel({ ...connected, serverName: '' })} onChange={(event) => rename(event.target.value)} /></SettingRow>
            </div>
            <div className="settings-group"><SettingRow title="在此设备保存密码" description="保存到当前浏览器本地；共享电脑不要开启。未来桌面版可改用 Windows 凭据管理器。"><Toggle label="在此设备保存密码" checked={rememberPassword} onChange={setRememberPassword} /></SettingRow></div>
            <div className="settings-actions"><button className="secondary-button" onClick={() => setEditing(!editing)}>{editing ? '收起连接信息' : '编辑连接信息'}</button><button className="text-button danger-button" onClick={() => { disconnect(); setEditing(false); }}>断开连接 / 更换服务器</button></div>
          </>}
          {(!connected || editing) && <form className="settings-form" onSubmit={connect}>
            <div className="form-section-title"><Radio size={17} /><span>{connected ? '更新服务器连接' : '连接 Navidrome'}</span></div>
            <label className="settings-field">服务器名称 <span>可选</span><input className="settings-input" value={settings.serverName || ''} onChange={(event) => setSettings({ ...settings, serverName: event.target.value })} placeholder="例如：家里的音乐库" /></label>
            <label className="settings-field">服务器地址<input required type="url" className="settings-input" value={settings.server} onChange={(event) => setSettings({ ...settings, server: event.target.value })} placeholder="https://music.example.com" /></label>
            <label className="settings-field">用户名<input required autoComplete="username" className="settings-input" value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} placeholder="你的用户名" /></label>
            <label className="settings-field">密码<input required type="password" autoComplete="current-password" className="settings-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" /></label>
            <div className="remember-password-field"><Toggle label="在此设备保存密码" checked={rememberPassword} onChange={setRememberPassword} /><span><strong>在此设备保存密码</strong><small>保存到当前浏览器本地；共享电脑不要开启。</small></span></div>
            <div className="settings-actions"><button className="primary-button" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} />连接中…</> : '测试并连接'}</button><button type="button" className="secondary-button" disabled={loading} onClick={useDemo}>使用演示模式</button></div>
            <p className="security-note">使用 Subsonic token 认证。保存密码仅使用当前浏览器本地存储，并非安全凭据存储；建议使用 HTTPS。</p>
          </form>}
          {!connected && <p className="settings-footnote">还没有连接音乐服务？可以先使用演示模式浏览 Tenma。</p>}
        </section>}

        {section === 'appearance' && <section className="settings-section" aria-labelledby="appearance-heading">
          <div className="settings-section-heading"><div><h2 id="appearance-heading">外观</h2><p>调整界面的颜色与启动时打开的页面。</p></div></div>
          <div className="settings-group"><SettingRow title="主题" description="当前版本使用简洁的深色界面"><span className="settings-value">深色</span></SettingRow><SettingRow title="强调色" description="用于按钮、选中状态和播放进度"><select aria-label="强调色" value={preferences.accent} onChange={(event) => update('accent', event.target.value as Preferences['accent'])}><option value="purple">柔紫</option><option value="blue">雾蓝</option></select></SettingRow><SettingRow title="启动时打开" description="下次打开或刷新时生效"><select aria-label="启动时打开" value={preferences.startPage} onChange={(event) => update('startPage', event.target.value as Preferences['startPage'])}><option value="home">主页</option><option value="library">资源库</option><option value="playlists">歌单</option></select></SettingRow></div>
        </section>}

        {section === 'playback' && <section className="settings-section" aria-labelledby="playback-heading">
          <div className="settings-section-heading"><div><h2 id="playback-heading">播放</h2><p>控制歌曲结束后的行为和默认音量。</p></div></div>
          <div className="settings-group"><SettingRow title="自动播放下一首" description="关闭后，当前歌曲播放结束即停止"><Toggle label="自动播放下一首" checked={preferences.autoNext} onChange={(value) => update('autoNext', value)} /></SettingRow><SettingRow title="默认音量" description="修改后立即应用，并用于下次启动"><span className="volume-setting"><input aria-label="默认音量" type="range" min="0" max="1" step="0.01" value={preferences.defaultVolume} onChange={(event) => update('defaultVolume', Number(event.target.value))} /><output>{Math.round(preferences.defaultVolume * 100)}%</output></span></SettingRow></div>
        </section>}

        {section === 'quality' && <section className="settings-section" aria-labelledby="quality-heading">
          <div className="settings-section-heading"><div><h2 id="quality-heading">音质</h2><p>设置音质与流量使用偏好。</p></div></div>
          <div className="settings-group"><SettingRow title="音质偏好" description="原始质量优先保留音源；较低质量偏好适合节省流量"><select aria-label="音质偏好" value={preferences.audioQuality} onChange={(event) => update('audioQuality', event.target.value as Preferences['audioQuality'])}><option value="original">原始质量</option><option value="high">高质量</option><option value="standard">标准质量</option><option value="data-saver">节省流量</option></select></SettingRow></div>
          <p className="settings-footnote">偏好已保存，实际可用质量取决于 Navidrome 设置。当前版本尚未将此偏好应用到音频流转码参数，不会改变实际播放音质。</p>
        </section>}

        {section === 'content' && <section className="settings-section" aria-labelledby="content-heading">
          <div className="settings-section-heading"><div><h2 id="content-heading">内容显示</h2><p>选择歌曲列表中需要显示的信息。</p></div></div>
          <div className="settings-group"><SettingRow title="显示专辑艺术家" description="在专辑卡片下方显示艺术家名称"><Toggle label="显示专辑艺术家" checked={preferences.showArtists} onChange={(value) => update('showArtists', value)} /></SettingRow><SettingRow title="显示歌曲时长" description="应用于歌曲列表、详情页和播放队列"><Toggle label="显示歌曲时长" checked={preferences.showDurations} onChange={(value) => update('showDurations', value)} /></SettingRow></div>
        </section>}

        {section === 'about' && <section className="settings-section" aria-labelledby="about-heading">
          <div className="settings-section-heading"><div><h2 id="about-heading">关于</h2><p>关于 Tenma（天马）音乐播放器。</p></div></div>
          <div className="about-brand"><span className="about-brand-mark"><Radio size={22} /></span><div><strong>Tenma</strong><small>自由聆听的个人音乐库播放器</small></div></div>
          <div className="about-list"><div><span>版本</span><strong>0.1.0</strong></div><div><span>音乐服务</span><strong>Navidrome / Subsonic API</strong></div><div><span>当前连接</span><strong>{connected ? serverLabel(connected) : '演示音乐库'}</strong></div></div>
        </section>}
        </div>
      </div>
    </div>
  </section>;
}
