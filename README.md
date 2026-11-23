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

## Screenshots

<p align="center"><img src="docs/screenshots/main.png" alt="Home with wallpaper theme" width="860" /></p>
<p align="center"><img src="docs/screenshots/now-playing.png" alt="Now Playing with progressively blurred lyrics" width="860" /></p>

## Features

- **Wallpaper themes** - Noir, Midnight and Spotify palettes, custom wallpaper with adjustable transparency and frosted-glass panels.
- **Full-screen Now Playing** - large artwork over a blurred cover backdrop, Up Next / Lyrics tabs.
- **Lyrics** - synced lyrics scroll smoothly with progressive distance blur; hover to sharpen, click a line to seek, scroll freely and jump back with *Back to current*; per-track offset input. Embedded tags, sibling `.lrc` files and LRCLIB fallback.
- **Two sources** - local folders (MP3, FLAC, WAV, OGG, OPUS, M4A, AAC) or Navidrome / Subsonic servers with auto-reconnect.
- **Everyday controls** - search, random recommendations, playlists, queue, shuffle/repeat, scroll-to-adjust volume, tray mode.
- **In-app updates** and English / Simplified Chinese UI.
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
# After setting the application version to 0.2.1 and committing the changes:
git push origin main
git tag -a v0.2.1 -m "Tenma Player v0.2.1"
git push origin v0.2.1
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
