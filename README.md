# Tenma 天马音乐

Tenma 是一个简洁的 Navidrome / Subsonic 音乐播放器，当前优先面向 Windows，前端使用 React + TypeScript + Vite。

“天马”代表自由、天空和飞翔。项目先以网页版本验证交互，现在已经接入 Tauri 2，继续以 Windows 桌面应用为主要目标。

## 当前功能

- Navidrome / Subsonic token 认证
- 服务器名称、自定义连接状态
- 专辑、歌手、歌单浏览
- 资源库统计与歌曲分页
- 资源库内搜索与随机推荐
- 专辑、歌手、歌单内嵌详情页
- 播放、暂停、上一首、下一首、进度、音量、队列
- 设置分类、音质偏好、播放偏好和内容显示选项
- 可选的本地密码保存（网页版本使用浏览器 localStorage；桌面版应改用系统凭据管理器）
- 未连接服务器时显示空白预览，不内置默认歌曲

## 开发

```powershell
cd E:\tenma
npm.cmd install
npm.cmd run dev
```

打开：

```text
http://localhost:5173/
```

构建检查：

```powershell
npm.cmd run build
node scripts/check.mjs
```

## Navidrome

在「设置 → 连接」中填写服务器地址、用户名和密码。密码不会写入 URL；如果开启“在此设备保存密码”，网页版本会写入当前浏览器本地存储。

## Tauri 2 Windows 开发

项目已经包含 `src-tauri/`，前端仍然使用同一套 React/Vite 页面。Tauri 桌面环境会使用 Rust HTTP 插件请求 Navidrome，浏览器开发环境继续使用普通 `fetch`。

```powershell
cd E:\tenma
npm.cmd install
npm.cmd run tauri:info
npm.cmd run tauri:dev
```

正式构建安装包：

```powershell
npm.cmd run tauri:build
```

本机 Windows 构建还需要 Visual Studio Build Tools 的 C++ 工具链和 Windows SDK。当前 GitHub Actions 已配置 Windows 构建任务，推送 `v*` 标签或手动运行 workflow 即可生成安装包 artifact。

后续正式版本应把密码保存迁移到 Windows Credential Manager。

如果未来需要替代方案：

- **Electron**：生态成熟、上手快，但安装包和内存占用更大。
- **PWA**：最快验证和分发，但不是传统 `.exe`，系统集成能力有限。

## 发布 Windows 版本

推送普通提交到 `main` 时，GitHub Actions 会自动构建并保存测试用安装包到 Actions Artifacts。

正式发布时使用版本标签：

```powershell
cd E:\tenma
git tag v0.1.0
git push origin v0.1.0
```

推送 `v*` 标签后，GitHub Actions 会自动：

1. 构建并签名 Windows 安装包与更新文件。
2. 生成 `latest.json` 更新清单。
3. 创建 GitHub Release。
4. 上传 `.exe`、`.msi`、签名文件和 `latest.json` 到 Release Assets。
5. 根据上一个标签到当前标签之间的提交自动生成更新说明。
6. 在 Release 正文中标注本次版本的安装包和更新内容。

### 应用内自动更新

Tenma 桌面版会在启动时检查 GitHub Release。发现新版本后，会在应用内显示更新提示，用户点击“立即更新”即可下载并安装，不需要手动查找安装包。

自动更新使用 Tauri 签名验证。发布前需要在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

私钥只放在 GitHub Actions Secret 中，不能提交到仓库。公钥可以安全地写入 `src-tauri/tauri.conf.json`。同一套签名私钥必须长期保留，后续版本不能更换，否则已安装版本无法验证新更新。

启用自动更新的第一个版本需要用户手动安装一次；之后的版本即可在应用内自动更新。

以后发布新版本只需递增标签，例如：

```powershell
git tag v0.1.1
git push origin v0.1.1
```

建议提交信息使用清晰的前缀，GitHub 自动更新说明会更容易阅读：

```text
feat: 新功能
fix: 修复问题
perf: 性能优化
style: 界面调整
docs: 文档更新
chore: 工程配置
```

## GitHub 持续开发

初始化本地仓库并提交：

```powershell
cd E:\tenma
git init -b main
git add .
git commit -m "chore: start Tenma music player"
```

在 GitHub 创建一个空仓库后，替换下面的地址：

```powershell
git remote add origin https://github.com/<你的用户名>/tenma.git
git push -u origin main
```

以后每次开发完成后：

```powershell
git add .
git commit -m "feat: 描述这次改动"
git push
```

建议使用分支开发：

```powershell
git switch -c feat/功能名称
```

完成后合并回 `main`，再打标签发布版本：

```powershell
git tag v0.1.0
git push origin v0.1.0
```
