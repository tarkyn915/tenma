<div align="center">

<img src="src-tauri/icons/icon.png" alt="Tenma Player 图标" width="96" />

# Tenma Player

**一款简洁、干净的 Navidrome / Subsonic 音乐播放器。**

专注你的音乐，轻松聆听自己的收藏。

[下载 Windows 版本](https://github.com/tarkyn915/tenma/releases/latest) · [反馈问题](https://github.com/tarkyn915/tenma/issues) · [English](README.md)

</div>

---

Tenma Player 将你的个人音乐服务器带入简洁的桌面界面。浏览收藏、搜索歌曲，或打开正在播放页面欣赏封面与歌词。项目使用 React、TypeScript、Vite 和 Tauri 2，目前主要面向 Windows 桌面环境。

## 功能

- **简洁界面**：深色背景、圆角控件，布局随窗口大小自适应。
- **个人音乐库**：连接 Navidrome 或兼容 Subsonic 的服务器，浏览专辑、歌手、歌单和歌曲。
- **搜索与推荐**：搜索收藏，或刷新随机推荐寻找想听的音乐。
- **正在播放**：大封面、歌曲信息、播放控制与歌词；服务器提供时间轴时支持歌词高亮和点击跳转。
- **日常播放控制**：播放、暂停、进度、随机、循环与队列。鼠标悬停在音量区域滚动可调节音量，点击图标可静音并恢复之前的音量。
- **应用内更新**：启动时自动检查，也可以在 **Settings → About** 中手动检查、下载和安装签名更新。

Tenma Player 是音乐服务器的客户端，不提供在线曲库，也不内置演示歌曲。

## 开始使用

1. 在 [Releases](https://github.com/tarkyn915/tenma/releases/latest) 下载 Windows x64 安装包。普通安装选择 `.exe`，也可以使用 `.msi`。
2. 安装并启动 **Tenma Player**。
3. 打开 **Settings → Connection**，填写服务器地址和账号，点击 **Test and connect**。
4. 播放歌曲后，点击底部播放器的封面或歌曲信息，进入 **Now Playing**。

支持自定义端口和服务器子路径，例如 `https://music.example.com` 或 `http://localhost:4533`。请填写服务器的基础地址。

歌词是否可用、是否包含时间轴，取决于服务器和音乐文件。较旧的服务器可能只提供纯文本歌词。

### 自动更新

桌面版启动时检查 GitHub Release，也可在 **Settings → About → Check for updates** 手动检查。发现新版本后点击 **Update now**，程序会下载、校验并安装更新。当前网络需要能够访问 GitHub。

早于 `0.1.3` 的旧版本需要先手动安装一次支持自动更新的版本，之后才能使用应用内更新。

## 开发与构建

### 环境要求

- Node.js 22 或更高版本及 npm。
- 真实音乐播放需要 Navidrome 或兼容服务器。
- 本机 Windows 桌面构建需要 Rust MSVC 工具链、Visual Studio Build Tools 的 C++ 工作负载和 Windows SDK。参考 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。

### 网页预览

```powershell
git clone https://github.com/tarkyn915/tenma.git
cd tenma
npm.cmd ci
npm.cmd run dev
```

打开 `http://localhost:5173/`。未连接时显示空音乐库。网页请求受服务器 CORS 设置约束；桌面版通过 Tauri Rust HTTP 客户端访问服务器。

### 桌面开发

```powershell
npm.cmd run tauri:dev
```

构建本机 Windows 安装包：

```powershell
npm.cmd run tauri:build
```

安装包位于 `src-tauri/target/release/bundle/`。普通本机构建无需更新签名私钥。

### 检查

```powershell
npm.cmd run build
node scripts/check.mjs
```

## 发布新版本

推送 `main` 会生成 Windows 测试构建；推送 `v*` 标签会生成签名安装包、签名文件和 `latest.json`，随后发布 GitHub Release。

发布前，需要同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 和关于页面中的版本号，标签也需要与应用版本一致。

```powershell
# 先将应用版本更新为 0.1.4 并提交修改，再执行：
git push origin main
git tag -a v0.1.4 -m "Tenma Player v0.1.4"
git push origin v0.1.4
```

在仓库的 Actions Secrets 中设置 `TAURI_SIGNING_PRIVATE_KEY`；只有私钥带密码时才需要 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公钥内置在应用中，私钥应备份在仓库之外，后续版本持续使用同一把私钥，确保已安装的客户端可以验证更新。

发布配置位于 `src-tauri/tauri.release.conf.json`；`scripts/create-updater-manifest.ps1` 根据对应版本的安装包和签名生成 Windows 更新清单。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/` | React 界面、播放状态、服务器接口和正在播放页面 |
| `src-tauri/` | 桌面端封装、权限、图标和安装包配置 |
| `.github/workflows/` | 构建检查与 Windows 发布流程 |
| `scripts/` | API/界面检查和更新清单生成 |

## 当前说明

- 可选的密码保存使用浏览器/WebView 本地存储，尚未接入系统凭据管理器。
- 音质偏好会保存，但尚未应用到音频流转码参数。
- 当前发布的桌面平台为 Windows x64，尚未发布其他系统版本。

## 许可证

桌面包元数据声明为 MIT。

English documentation: [README.md](README.md).
