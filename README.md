<div align="center">

<img src="src-tauri/icons/icon.png" alt="Tenma Player icon" width="96" />

# Tenma Player

**A clean, minimal music player for Navidrome and Subsonic-compatible servers.**

Your library. Your music. A focused listening experience.

[Download for Windows](https://github.com/tarkyn915/tenma/releases/latest) · [Report an issue](https://github.com/tarkyn915/tenma/issues) · [Chinese README](README.zh-CN.md)

[![Windows desktop build](https://github.com/tarkyn915/tenma/actions/workflows/desktop.yml/badge.svg)](https://github.com/tarkyn915/tenma/actions/workflows/desktop.yml)
[![Latest release](https://img.shields.io/github/v/release/tarkyn915/tenma)](https://github.com/tarkyn915/tenma/releases/latest)

</div>

---

Tenma Player brings your personal music server into a simple desktop interface. Browse your collection, find something to play, and open the Now Playing view for artwork and lyrics. Built with React, TypeScript, Vite, and Tauri 2, with Windows as the current desktop target.

## Made for listening

- **A clean interface** — dark surfaces, rounded controls, and responsive layouts that adapt to your window.
- **Your music library** — browse albums, artists, playlists, and tracks from Navidrome or a Subsonic-compatible server.
- **Search and discovery** — search your collection or refresh random recommendations.
- **Now Playing** — large artwork, track details, playback controls, and lyrics. Timed lyrics support highlighting and seeking when supplied by your server.
- **Everyday controls** — play, pause, seek, shuffle, repeat, and manage the queue. Scroll over the volume control to adjust it, or click its icon to mute and restore the previous volume.
- **In-app updates** — check for signed releases at startup or from **Settings → About**; download and install without finding an installer yourself.

Tenma Player is a client for your music server. It does not include a music catalog or bundled demo tracks.

## Get started

1. Download the latest Windows x64 installer from [Releases](https://github.com/tarkyn915/tenma/releases/latest). Choose the `.exe` for a regular installation; an `.msi` is also available.
2. Install and open **Tenma Player**.
3. Go to **Settings → Connection**, enter your server address and credentials, and select **Test and connect**.
4. Play a track. Click its artwork or title in the bottom player to open **Now Playing**.

Custom ports and server subpaths are supported. Use your server's base address, such as `https://music.example.com` or `http://localhost:4533`.

Lyrics availability and timing depend on your server and music files. Some older servers only provide plain-text lyrics.

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
| `src/` | React UI, playback state, server API, and Now Playing view |
| `src-tauri/` | Native desktop shell, permissions, icons, and packaging |
| `.github/workflows/` | Build checks and Windows release automation |
| `scripts/` | API/UI checks and updater manifest generation |

## Current notes

- Optional password saving uses local browser/WebView storage rather than the operating system's credential vault.
- The audio quality preference is saved but is not yet applied to stream transcoding parameters.
- The current desktop release targets Windows x64. Other desktop platforms are not published yet.

## License

MIT, as declared in the desktop package metadata.

For Chinese documentation, see [README.zh-CN.md](README.zh-CN.md).
