# Nohop Codex

基于 **Wails v2 + Go + React/xterm.js** 的轻量 SSH 桌面终端。应用使用系统 WebView，不再携带 Electron/Chromium。

- Linux 远端优先使用 `tmux`，没有时回退到 `screen`。
- Windows 远端通过内嵌的 Go ConPTY 代理保持 PowerShell 会话。
- 关闭标签页、断开 SSH 或退出应用只会 detach；远端进程继续运行。点击垃圾桶并确认才会结束会话。
- 首页读取并展示 `~/.ssh/config` 主机，可直接编辑配置并点击连接。支持密码、私钥（含口令）、SSH Agent 和 keyboard-interactive 认证；需要密码或私钥口令时会弹窗询问。
- 支持 SSH config 的单级 `ProxyJump`，跳板机和目标服务器分别使用各自的用户、端口与私钥配置。
- Tailscale SSH check mode 返回登录地址时，会自动使用系统浏览器打开，完成 approve 后继续连接。首次连接仍需确认主机密钥指纹，已保存的主机密钥发生变化时会拒绝连接。

## 开发环境

需要 Node.js 24+、Go 1.27+。Wails CLI 由脚本使用 `go.mod` 中固定的版本运行，无需单独全局安装。

Linux（Ubuntu 24.04 / Debian 12）需要：

```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev build-essential pkg-config
```

Windows 需要 WebView2 Runtime；构建安装包还需安装 NSIS 并将 `makensis` 加入 PATH。Windows SSH Agent 默认连接 OpenSSH 的 `\\.\pipe\openssh-ssh-agent`，也支持 `SSH_AUTH_SOCK`；Linux 使用 `SSH_AUTH_SOCK`。

```bash
npm ci
npm run dev
```

`npm run dev` 会先编译 Windows 远端代理，再启动 Wails 和 Vite。`npm run dev:frontend` 仅启动界面开发服务器，SSH 功能需要 Wails 宿主。

```bash
npm test
npm run test:go
npm run build
```

`npm run build` 只编译前端。Go 后端位于 `internal/sshclient/`，`app.go` 提供 Wails 方法和原生对话框，`src/renderer/src/desktop-api.ts` 对接前端调用。

## 打包

在对应操作系统运行：

```bash
npm run package:linux
# 或在 Windows 上
npm run package:windows
```

脚本自动编译并内嵌 Windows 远端代理及前端资源，输出到 `release/`：

- Linux：`.deb` 和包含可执行文件的 `.tar.gz`（替代原 Electron AppImage）。运行需要 GTK3 和 WebKitGTK 4.1，`.deb` 声明了这两个依赖；手动使用压缩包时可执行 `sudo apt-get install libgtk-3-0 libwebkit2gtk-4.1-0`。
- Windows：独立 `.exe` 和 NSIS 安装包。运行需要 WebView2；安装包使用 Wails 的 WebView2 安装流程。

旧 Electron 产物不会自动删除，请根据文件名区分。Wails 包不内置浏览器运行时，因此安装包体积不包含系统 WebView 的占用。

## 远端要求与会话

Linux 远端安装 `tmux`（推荐）或 `screen`。Windows 远端需要 Windows 10 1809 / Server 2019 或更高版本、OpenSSH Server 和 PowerShell 5.1+。

连接 Windows 时，应用通过 SFTP 上传缺失的代理到 `%LOCALAPPDATA%\NohopCodex\nohop-agent.exe`。代理仅监听回环地址，使用随机令牌认证，保留最近 2 MiB 输出。现有远端代理和会话可继续使用。

密码和私钥口令不会写入磁盘。服务器公钥保存在系统用户配置目录下的 `NohopCodex/known_hosts`（Linux 通常为 `~/.config/NohopCodex/known_hosts`，Windows 通常为 `%APPDATA%\NohopCodex\known_hosts`）。确认管理员更换了服务器主机密钥后，才能手动更新该文件。

## 自动构建与发布

推送 main 或提交 PR 时运行前端测试、类型检查和 Go 后端竞态测试。推送 `v1.2.3` 或 `v1.2.3-beta.1` tag 后，在 Linux 和 Windows runner 上分别构建安装包，保留 Actions artifacts 30 天，并上传到对应 GitHub Release。

```bash
git tag -a v0.1.0 -m "Nohop Codex v0.1.0"
git push origin v0.1.0
```

Wails 系统要求和构建说明：https://wails.io/docs/gettingstarted/installation/
