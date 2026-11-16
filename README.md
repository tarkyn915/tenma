<div align="center">

<img src="src-tauri/icons/icon.png" alt="Tenma Player icon" width="96" />

# Tenma Player

**A clean, minimal music player for Navidrome, Subsonic-compatible servers, and local folders.**

Your library. Your music. A focused listening experience.

[Download for Windows](https://github.com/tarkyn915/tenma/releases/latest) · [Report an issue](https://github.com/tarkyn915/tenma/issues) · [Chinese README](README.zh-CN.md)

[![Windows desktop build](https://github.com/tarkyn915/tenma/actions/workflows/desktop.yml/badge.svg)](https://github.com/tarkyn915/tenma/actions/workflows/desktop.yml)
[![Latest release](https://img.shields.io/github/v/release/tarkyn915/tenma)](https://github.com/tarkyn915/tenma/releases/latest)

</div>

---

Tenma Player brings your music into a simple desktop interface. Connect a Navidrome or Subsonic-compatible server, or point it at a local folder on your computer, then browse, search, and play. Built with React, TypeScript, Vite, and Tauri 2, with Windows as the current desktop target.

## Made for listening

- **A clean interface** — dark surfaces, rounded controls, responsive layouts, and two themes (**Midnight** and **Graphite**).
- **Two sources, one library** — use a local folder as your library, or connect a Navidrome / Subsonic-compatible server. Local mode scans subfolders, reads tags, bitrate, and artwork, and remembers your folder between sessions.
- **Search and discovery** — search your collection, or refresh random recommendations right on the home screen.
- **Now Playing** — large auto-sizing artwork, track details, playback controls, and an **Up Next / Lyrics** tabbed panel. Timed lyrics highlight and follow along with a blurred, distance-faded context; plain-text lyrics stay centered and seekable. The cover scales to fit the window so everything stays on one screen.
- **Everyday controls** — play, pause, seek, shuffle, repeat, and manage the queue. Right-click a track (or use its menu button) to add it to a playlist or jump to its artist and album. Scroll over the volume control to adjust it, or click its icon to mute and restore the previous volume.
- **Playlists at hand** — a collapsible playlist section in the sidebar and a playlist grid on the home screen, each opening its playlist in one click.
- **Lyrics built in** — local songs read embedded lyrics (USLT / ©lyr / FLAC `LYRICS` and `UNSYNCEDLYRICS`) and sibling `.lrc` files; when nothing is embedded, an online lyrics lookup (LRCLIB) fills the gap.
- **Localized** — switch between English and Simplified Chinese in **Settings → General**.
- **Reconnects for you** — remembered servers reconnect automatically on startup and when switching back from local mode.
- **Runs in the background** — minimize to the system tray and reopen from its icon without quitting playback.
- **In-app updates** — check for signed releases at startup or from **Settings → About**; download and install without finding an installer yourself.

Tenma Player plays music from your own library — a local folder or a Navidrome / Subsonic server. It ships empty and never bundles demo tracks.

## Get started

1. Download the latest Windows x64 installer from [Releases](https://github.com/tarkyn915/tenma/releases/latest). Choose the `.exe` for a regular installation; an `.msi` is also available.
2. Install and open **Tenma Player**.
3. Choose a source in **Settings → Connection**: pick a **Local folder** (and optionally rescan it later), or enter a server address and credentials and select **Test and connect**.
4. Play a track. Click its artwork or title in the bottom player to open **Now Playing**.

Custom ports and server subpaths are supported. Use your server's base address, such as `https://music.example.com` or `http://localhost:4533`. Local mode supports MP3, FLAC, WAV, OGG, OPUS, M4A, and AAC.

Lyrics availability and timing depend on your server and music files. Some older servers only provide plain-text lyrics. When a track has no embedded or served lyrics, Tenma Player queries the free LRCLIB lyrics database.

### Updates

The desktop app checks GitHub Releases at startup. You can also select **Check for updates** in **Settings → About**. When a newer version is available, select **Update now** to download, verify, and install it. GitHub must be reachable from your network.

Users on versions older than `0.1.3` need to install an updater-enabled version once before using in-app updates.

## Build and develop

### Requirements

- Node.js 22 or later and npm.
- A Navidrome or compatible server for real music playback.
- For Windows desktop builds: Rust with the MSVC toolchain, Visual Studio Build Tools with the C++ workload, and a Windows SDK. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Web preview

```powershell
git clone https://github.com/tarkyn915/tenma.git
cd tenma
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:5173/`. The disconnected preview starts with an empty library. Browser requests follow the server's CORS policy; the desktop app uses Tauri's Rust HTTP client.

### Desktop development

```powershell
npm.cmd run tauri:dev
```

Build a local Windows installer:

```powershell
npm.cmd run tauri:build
```

Installers are written to `src-tauri/target/release/bundle/`. Local builds do not require the update signing key.

### Checks

```powershell
npm.cmd run build
node scripts/check.mjs
```

## Publish a release

Pushes to `main` produce Windows build artifacts. A `v*` tag produces signed installers, updater signatures, and `latest.json`, then publishes a GitHub Release.

Before tagging, keep the versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and the About screen in sync. The tag must match the application version.

```powershell
# After setting the application version to 0.1.4 and committing the changes:
git push origin main
git tag -a v0.1.4 -m "Tenma Player v0.1.4"
git push origin v0.1.4
```

Configure `TAURI_SIGNING_PRIVATE_KEY` in the repository's Actions secrets. Add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key is password protected. The public verification key is embedded in the app. Keep the private key backed up outside the repository and reuse it for future releases so installed clients can verify updates.

The release configuration is `src-tauri/tauri.release.conf.json`; `scripts/create-updater-manifest.ps1` generates the Windows update manifest from the matching installer and signature.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React UI, playback state, server and local-library APIs, and Now Playing view |
| `src-tauri/` | Native desktop shell, tray, local-folder scanning, permissions, icons, and packaging |
| `.github/workflows/` | Build checks and Windows release automation |
| `scripts/` | API/UI checks, layout and interaction checks, icon tooling, and updater manifest generation |

## Current notes

- Optional password saving uses local browser/WebView storage rather than the operating system's credential vault.
- The audio quality preference is saved but is not yet applied to stream transcoding parameters.
- The current desktop release targets Windows x64. Other desktop platforms are not published yet.

## License

MIT, as declared in the desktop package metadata.

For Chinese documentation, see [README.zh-CN.md](README.zh-CN.md).
