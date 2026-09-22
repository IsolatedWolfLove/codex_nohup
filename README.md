# Nohop Codex

一个专注于“断开 SSH 后任务仍继续、回来点击即可重新进入”的桌面终端。

- Linux 自动优先使用 `tmux`，没有时回退到 `screen`。
- Windows 使用随应用分发的 `nohop-agent`，通过原生 ConPTY 持有 PowerShell 会话。
- 关闭终端标签、SSH 断线、电脑休眠或退出应用都只会 detach；远端会话和其中的进程继续运行。
- 左侧实时列出远端会话，点击会话卡片即可 attach；垃圾桶按钮才会真正结束会话。

## 工作原理

Linux 上，应用通过 SSH 启动一个有 PTY 的 `tmux attach/new-session` 或 `screen -xRR`。终端内容与进程属于远端复用器，SSH 连接只负责显示和输入。

Windows 没有系统自带的 tmux 等价物。Nohop Codex 会把一个小型代理上传到当前用户的 `%LOCALAPPDATA%\\NohopCodex`。代理在 `127.0.0.1` 上运行，使用 ConPTY 创建 PowerShell，保存最近 2 MiB 输出，并允许新的 SSH 连接接回同一终端。监听端口按 Windows 用户派生，连接还需本地随机令牌。

## 开发

需要 Node.js 24+。若要构建 Windows 代理，还需要 Go 1.23+。

```bash
npm install
npm test
npm run typecheck
npm run agent:win
npm run dev
```

Linux 远端需安装 `tmux`（推荐）或 `screen`。Windows 远端需 Windows 10 1809 / Server 2019 或更高版本、OpenSSH Server 和 PowerShell 5.1+。开发模式连接 Windows 前必须先运行 `npm run agent:win`；发行包通过 `extraResources` 携带生成的代理。

## 使用

1. 输入 SSH 地址和认证信息并连接。
2. 填写会话名称，按需填写远端工作目录，点击“新建并进入”。
3. 临时离开时直接关闭标签页或应用即可。
4. 再次连接同一服务器，点击左侧同名会话继续。

密码只用于当前连接，不会写入磁盘。SSH Agent 和本地私钥认证也受支持。

## Tag 自动构建

推送 `v1.2.3` 或 `v1.2.3-beta.1` 格式的 tag 后，GitHub Actions 会分别在 Linux 和 Windows runner 上构建 AppImage、Debian/Ubuntu 的 `.deb` 与 Windows NSIS 安装包，并在该次 Actions Run 中保留产物 30 天。

```bash
git tag -a v0.1.0 -m "Nohop Codex v0.1.0"
git push origin v0.1.0
```

构建完成后可从 GitHub 的 Actions 页面下载 `nohop-codex-linux-<tag>` 和 `nohop-codex-windows-<tag>` 两个 artifacts；Linux artifact 包含 `.AppImage` 和 `.deb`，这些安装包也会自动上传到对应 tag 的 GitHub Release。

本地构建 Linux 安装包（x64）：

```bash
npm run agent:win
npm run package:linux
```

产物位于 `release/` 目录。

### 安装包体积

发行包仅保留 Electron 的英文、简体中文和繁体中文语言资源，并使用 `maximum` 压缩（打包时间会增加）。这不限制终端显示其他语言的文本；如需其他语言的系统菜单或对话框，可在 `package.json` 的 `build.electronLanguages` 中添加对应语言。

安装包的大部分体积来自 Electron 自带的 Chromium 和 Node.js。`release/linux-unpacked/` 是未压缩的应用目录，不应与安装包一起分发。Windows 远端代理在所有平台均需保留，用于连接 Windows 服务器。
