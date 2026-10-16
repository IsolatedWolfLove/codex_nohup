# Nohop Codex

基于 **Wails v2 + Go + React/xterm.js** 的轻量 SSH 桌面终端。应用使用系统 WebView，不再携带 Electron/Chromium。

- Linux 远端优先使用 `tmux`，没有时回退到 `screen`。
- Windows 远端通过内嵌的 Go ConPTY 代理保持 PowerShell 会话。
- 关闭标签页、断开 SSH 或退出应用只会 detach；远端进程继续运行。点击垃圾桶并确认才会结束会话。
- 首页读取并展示 `~/.ssh/config` 主机，可直接编辑配置并点击连接。支持密码、私钥（含口令）、SSH Agent 和 keyboard-interactive 认证；需要密码或私钥口令时会弹窗询问。
- 支持 SSH config 的单级 `ProxyJump`，跳板机和目标服务器分别使用各自的用户、端口与私钥配置。
- Tailscale SSH check mode 返回登录地址时，会自动使用系统浏览器打开，完成 approve 后继续连接。首次连接仍需确认主机密钥指纹，已保存的主机密钥发生变化时会拒绝连接。
- 鼠标滚轮用于查看历史输出，不再转换成上下方向键。右侧竖栏可拖动；`tmux` 会话直接读取远端历史位置，普通终端使用本地历史。

## SSH 配置与自动认证

点击 SSH config 中的主机时，应用自动尝试 SSH Agent 和文件密钥，失败后再询问密码。未配置 `IdentityFile` 时，会查找当前用户 `~/.ssh/` 下的 `id_rsa`、`id_ecdsa`、`id_ed25519` 和 `id_dsa`；默认名称的密钥无需在配置中显式指定。

自定义密钥文件使用 `IdentityFile`，可以指定多条。匹配的 `Host` 块中的密钥会依次尝试；缺失或无法解析的密钥不会阻止其他密钥、Agent 或密码认证。目标机和跳板机使用相同的自动认证逻辑。

```sshconfig
Host work
  HostName server.example.com
  User ubuntu
  # 使用默认密钥时无需填写 IdentityFile

Host private
  HostName 192.168.1.20
  User ubuntu
  IdentityFile ~/.ssh/work_key
  IdentityFile ~/.ssh/backup_key
  ProxyJump work
```

加密密钥需要口令时会弹窗询问。对于能读取公钥的加密密钥，会先让服务器检查公钥，确认可用后才询问口令；已载入 Agent 的密钥无需重复解锁。Linux 下桌面应用需要继承 `SSH_AUTH_SOCK` 才能访问 Agent；从终端启动应用和从桌面启动应用的环境变量可能不同。

应用自行解析 SSH config，并非直接调用系统 OpenSSH，当前支持常用主机字段、多条 `IdentityFile` 和单级 `ProxyJump`，尚未完整支持 OpenSSH 的所有配置指令，例如 `Include`、`Match` 和 `IdentityAgent`。

## 终端操作与历史滚动

- 滚轮向上查看历史，向下回到较新的输出；右侧竖栏可拖动到指定位置。
- `tmux` 会话的历史保存在远端。滚动时进入历史模式，回到底部或开始输入时恢复实时终端；关闭标签或断开连接时清理应用进入的历史模式。
- 普通终端滚动本地已接收的历史输出。`screen` 的远端历史暂未接入右侧竖栏；本地没有历史时，滚轮不会发送上下方向键。
- 选中文本后按 `Ctrl+Shift+C` 或 `Ctrl+Insert` 复制；按 `Ctrl+Shift+V` 或 `Shift+Insert` 粘贴，也可使用右键菜单。

## 多服务器、分屏与工作区恢复

- 左侧「连接其他服务器」可添加独立 SSH 连接；切换服务器不会关闭其他服务器的终端。同名会话按服务器区分。
- 打开多个会话后，使用终端上方的「左右分屏」「上下分屏」或「网格」同时显示；点击面板选择输入焦点。「单屏」恢复标签模式。
- 网络断开后，应用按 1、2、4、8、16、30 秒的间隔重试，随后每 30 秒重试。连接恢复后重新挂接原来的持久会话；已在远端结束的会话不会被重建。主动断开会从工作区移除该服务器并停止重连。
- 应用自动保存服务器、打开的会话、面板顺序、当前标签和布局，下次启动时恢复。密码和私钥口令不保存；需要时重新询问。取消认证或主机密钥校验失败会暂停恢复，点击服务器旁的重试按钮继续。

## 截图粘贴到远端 AI

在本机截图并复制到剪贴板后，聚焦目标终端，按 `Ctrl+Shift+V` / `Shift+Insert` 或使用右键「粘贴」。也支持系统原生粘贴事件中的图片（如 `Ctrl+V`）。

应用通过 SFTP 将图片上传到**该终端所在的服务器**，然后插入带引号的远端文件路径。请在支持读取本地图片文件的远端 AI CLI 中提交此路径及问题；应用不会自动发送回车。普通文本继续按原方式粘贴。

- Windows 本机通过系统剪贴板读取截图；Linux 本机的快捷键及右键截图粘贴需要 Wayland 下的 `wl-clipboard`（`wl-paste`）或 X11 下的 `xclip`。原生粘贴事件能提供图片时无需调用这些工具。
- 远端需启用 SFTP 子系统。支持 PNG、JPEG、GIF、WebP，单张最大 20 MiB；系统剪贴板读取使用 PNG。
- Linux 远端目录为 `~/.local/share/nohop-codex/images/`，文件权限为 `0600`；Windows 为 `%LOCALAPPDATA%\NohopCodex\images\`。
- 上传的截图会保留在服务器，便于 AI 后续读取，可按需手动清理。AI 本身须支持图片输入及文件路径读取。

## v2.4.5 更新

- 修正终端可用高度计算，避免最下面一行被遮挡，并在窗口缩放、字体就绪和标签切换后同步尺寸。
- 补齐 SSH 默认密钥、多条 `IdentityFile`、Agent 回退和加密密钥解锁，目标机及跳板机均适用。
- 将滚轮和右侧竖栏接入 `tmux` 远端历史，避免滚轮产生上下键效果，并处理输入、Esc 和关闭标签后的历史模式退出。
- 更新使用说明；本版本包含 v2.4.2–v2.4.4 的修复。

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
git tag -a v2.4.5 -m "Nohop Codex v2.4.5"
git push origin v2.4.5
```

发布构建会从 tag 自动设置 `package.json`、锁文件和 Wails 产品版本。构建完成后，可在 [GitHub Releases](https://github.com/IsolatedWolfLove/codex_nohup/releases) 下载对应版本的安装包。

Wails 系统要求和构建说明：https://wails.io/docs/gettingstarted/installation/
