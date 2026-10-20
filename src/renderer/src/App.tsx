import { FileBrowser } from './FileBrowser';
import { desktop, decodeTerminalData } from './desktop-api';
import { useWorkspace, type OpenTerminal } from './use-workspace';
import { bindTerminalScrolling } from './terminal-scrolling';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ChevronRight, Copy, FilePenLine, KeyRound, LogOut, ClipboardPaste, Plus, RefreshCw, Server, SquareTerminal, Trash2, X } from 'lucide-react';
import type { AuthMethod, CredentialRequest, PersistentSession, SSHHost, TerminalEvent, TerminalScrollState } from '../../shared/contracts';


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function TerminalView({ item, active, focused, onFocus }: { item: OpenTerminal; active: boolean; focused: boolean; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<(() => void) | null>(null);
  const scrolling = useRef<ReturnType<typeof bindTerminalScrolling> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [scrollState, setScrollState] = useState<TerminalScrollState>({ lines: 0, position: 0, rows: 24 });
  const [scrollError, setScrollError] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);

  const copySelection = useCallback(() => {
    const instance = terminal.current;
    const selected = instance?.getSelection();
    if (selected) void desktop.clipboardSetText(selected).catch((error) => instance?.writeln(`\r\n${errorMessage(error)}`));
    setContextMenu(null);
    instance?.focus();
  }, []);

  const uploading = useRef(false);
  const uploadImage = useCallback(async (data: string) => {
    const instance = terminal.current;
    if (uploading.current) return;
    uploading.current = true;
    setScrollError('正在上传截图…');
    try {
      const path = await desktop.uploadImage(item.id, data);
      // Paste a quoted path only. Never submit or execute the AI prompt.
      if (terminal.current === instance) instance?.paste("'" + path.replaceAll("'", item.backend === 'conpty' ? "''" : "'\\''") + "' ");
      setScrollError('截图已上传，图片路径已粘贴；请在 AI 中提交。');
    } catch (error) { setScrollError(errorMessage(error)); }
    finally { uploading.current = false; }
  }, [item.id, item.backend]);

  const pasteClipboard = useCallback(() => {
    const instance = terminal.current;
    setContextMenu(null); instance?.focus();
    void (async () => {
      const image = await desktop.clipboardGetImage();
      if (terminal.current !== instance) return;
      if (image) { await uploadImage(image); return; }
      const value = await desktop.clipboardGetText();
      if (value && terminal.current === instance) instance?.paste(value);
      else if (!value) setScrollError('剪贴板没有可粘贴的内容。');
    })().catch((error) => setScrollError(errorMessage(error)));
  }, [uploadImage]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onPaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.items ?? []).find(item => item.type.startsWith('image/'))?.getAsFile();
      if (!image) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (image.size > 20 * 1024 * 1024) { setScrollError('截图不能超过 20 MiB'); return; }
      const reader = new FileReader();
      reader.onload = () => void uploadImage(String(reader.result).split(',')[1]);
      reader.readAsDataURL(image);
    };
    element.addEventListener('paste', onPaste, true);
    return () => element.removeEventListener('paste', onPaste, true);
  }, [uploadImage]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', closeOnPointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!surface.current) return;
    const instance = new Terminal({ cursorBlink: true, convertEol: false, fontFamily: 'JetBrains Mono, Cascadia Code, monospace', fontSize: 14, theme: { background: '#080b10', foreground: '#d7e0ea', cursor: '#64d8cb', selectionBackground: '#264b52' } });
    const addon = new FitAddon();
    instance.loadAddon(addon); instance.open(surface.current);
    let frame = 0;
    let disposed = false;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!surface.current?.clientWidth || !surface.current.clientHeight) return;
        addon.fit();
        if (instance.cols > 0 && instance.rows > 0) void desktop.resizeTerminal(item.id, instance.cols, instance.rows).catch(() => undefined);
      });
    };
    terminal.current = instance; fit.current = scheduleFit;
    const scroller = bindTerminalScrolling(instance, surface.current, item.backend, item.id, desktop,
      (state) => { setScrollState(state); setScrollError(''); },
      (error) => setScrollError(errorMessage(error)), () => activeRef.current);
    scrolling.current = scroller;
    scheduleFit();
    void document.fonts.ready.then(() => { if (!disposed) scheduleFit(); });
    instance.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const copy = (event.ctrlKey && event.shiftKey && event.code === 'KeyC') || (event.ctrlKey && event.code === 'Insert');
      const paste = (event.ctrlKey && event.shiftKey && event.code === 'KeyV') || (event.shiftKey && event.code === 'Insert');
      if (copy) {
        event.preventDefault();
        event.stopPropagation();
        copySelection();
        return false;
      }
      if (paste) {
        event.preventDefault();
        event.stopPropagation();
        pasteClipboard();
        return false;
      }
      return true;
    });
    const input = instance.onData((data) => void desktop.writeTerminal(item.id, data).catch((error) => instance.writeln(errorMessage(error))));
    const unsubscribe = desktop.onTerminalEvent((event: TerminalEvent) => {
      if (event.terminalId !== item.id) return;
      if (event.type === 'data') instance.write(decodeTerminalData(event.data));
      if (event.type === 'error') instance.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
      if (event.type === 'exit') instance.writeln('\r\n\x1b[90m[连接已断开，会话仍在远端运行]\x1b[0m');
    });
    void desktop.readyTerminal(item.id).catch((error) => instance.writeln(errorMessage(error)));
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(surface.current);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.dispose(); scrolling.current = null;
      unsubscribe(); input.dispose(); instance.dispose(); terminal.current = null; fit.current = null;
    };
  }, [item.id, item.backend, copySelection, pasteClipboard]);

  useEffect(() => {
    if (active) fit.current?.();
    else setContextMenu(null);
    if (focused) terminal.current?.focus();
  }, [active, focused, item.id]);
  return <div ref={host} className={`terminal-host ${active ? 'active' : ''}`} onPointerDown={onFocus} onFocusCapture={onFocus} onContextMenu={(event) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width - 150)),
      y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height - 86)),
      canCopy: terminal.current?.hasSelection() ?? false,
    });
  }}>
    <div ref={surface} className="terminal-surface" />
    <div className="mobile-keys" aria-label="终端快捷键">
      {([['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['Ctrl+Z', '\x1a'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']] as const).map(([label, data]) => <button key={label} onPointerDown={event => event.preventDefault()} onClick={() => { terminal.current?.input(data, true); terminal.current?.focus(); }}>{label}</button>)}
      <button onPointerDown={event => event.preventDefault()} onClick={pasteClipboard}>粘贴</button>
      <button onClick={copySelection}>复制选区</button>
    </div>
    <input className="terminal-scrollbar" type="range" min={0} max={Math.max(1, scrollState.lines)} step={1}
      value={scrollState.position} disabled={scrollState.lines === 0} aria-label="终端滚动条" aria-orientation="vertical"
      aria-valuetext={scrollState.position === scrollState.lines ? '最新输出' : `历史第 ${scrollState.position + 1} 行`}
      onChange={(event) => scrolling.current?.setPosition(Number(event.target.value))} />
    {scrollError && <div className="terminal-scroll-error" role="status">{scrollError}</div>}
    {contextMenu && <div ref={menu} className="terminal-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
      <button type="button" role="menuitem" disabled={!contextMenu.canCopy} onClick={copySelection}><Copy size={15} />复制</button>
      <button type="button" role="menuitem" onClick={pasteClipboard}><ClipboardPaste size={15} />粘贴</button>
    </div>}
  </div>;
}

export function App() {
  const [fileServer, setFileServer] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState('');
  const { servers, terminals, setTerminals, selected, setSelected, activeId, setActiveId, layout, setLayout, addServer, removeServer, recover } = useWorkspace(setMessage);
  const server = servers.find(s => s.input.connectionId === selected);
  const connected = server?.info ?? null;
  const [sessions, setSessions] = useState<PersistentSession[]>([]);
  const [showConnections, setShowConnections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState(''); const [port, setPort] = useState(22); const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password'); const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState(''); const [passphrase, setPassphrase] = useState('');
  const [newName, setNewName] = useState('nohop-work'); const [cwd, setCwd] = useState('');
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [showAddHost, setShowAddHost] = useState(false);
  const [sshCommand, setSSHCommand] = useState('');
  const [sshAlias, setSSHAlias] = useState('');
  const [addError, setAddError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [configText, setConfigText] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialRequest[]>([]);
  const credential = credentials[0];
  const [credentialValue, setCredentialValue] = useState('');

  const loadHosts = useCallback(async () => {
    try { setHosts(await desktop.listSSHHosts()); } catch (error) { setMessage(errorMessage(error)); }
  }, []);

  useEffect(() => { void loadHosts(); }, [loadHosts]);
  useEffect(() => {
    const offCredential = desktop.onCredentialRequest((request) => { setCredentials(current => [...current, request]); });
    const offUrl = desktop.onAuthUrl(() => setMessage('已在浏览器打开认证页面，完成 approve 后会自动继续连接…'));
    return () => { offCredential(); offUrl(); };
  }, []);

  const selectedRef = useRef(selected); selectedRef.current = selected;
  const refresh = useCallback(async () => {
    if (!connected) { setSessions([]); return; }
    try { const items = await desktop.listSessions(selected!); if (selectedRef.current === selected) { setSessions(items); setMessage(''); } }
    catch (error) { setMessage(errorMessage(error)); }
  }, [connected, selected]);

  useEffect(() => { setSessions([]); void refresh(); }, [refresh]);

  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('正在连接…');
    try {
      const info = await addServer({ connectionId: crypto.randomUUID(), host, port, username, authMethod, password, privateKeyPath, passphrase });
      if (!info) return; setShowConnections(false); setPassword(''); setPassphrase(''); setMessage(info.backend === 'none' ? '已连接，但 Linux 服务器未安装 tmux/screen。' : '已连接');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function connectHost(alias: string) {
    setBusy(true); setMessage(`正在连接 ${alias}…`);
    try {
      const info = await addServer({ connectionId: crypto.randomUUID(), alias, host: alias, port: 22, username: '', authMethod: 'auto' });
      if (!info) return; setShowConnections(false); setMessage(info.backend === 'none' ? '已连接，但 Linux 服务器未安装 tmux/screen。' : '已连接');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function addHost(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setAddError('');
    try {
      const alias = sshAlias.trim();
      await desktop.addSSHHost(alias, sshCommand);
      setShowAddHost(false); setSSHCommand(''); setSSHAlias('');
      await loadHosts();
      await connectHost(alias);
    } catch (error) { setAddError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function editConfig() {
    try { setConfigText(await desktop.getSSHConfig()); } catch (error) { setMessage(errorMessage(error)); }
  }

  async function saveConfig() {
    if (configText === null) return;
    try { await desktop.saveSSHConfig(configText); setConfigText(null); await loadHosts(); setMessage('SSH config 已保存'); }
    catch (error) { setMessage(errorMessage(error)); }
  }

  function answerCredential(cancelled: boolean) {
    if (!credential) return;
    void desktop.submitCredential(credential.id, credentialValue, cancelled);
    setCredentials(current => current.slice(1)); setCredentialValue('');
  }

  async function open(name: string) {
    if (terminals.some((terminal) => terminal.name === name && terminal.connectionId === selected)) {
      setActiveId(terminals.find((terminal) => terminal.name === name && terminal.connectionId === selected)!.key); return;
    }
    setBusy(true); setMessage(`正在进入 ${name}…`);
    try {
      const result = await desktop.openSession({ connectionId: selected!, name, cwd });
      const item = { key: crypto.randomUUID(), connectionId: selected!, cwd, id: result.terminalId, name: result.sessionName, backend: result.backend };
      setTerminals((current) => [...current, item]); setActiveId(item.key); setMessage('');
      window.setTimeout(() => void refresh(), 500);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function kill(name: string, connectionId = selected!) {
    try {
      if (!await desktop.confirmKill(name)) return;
      await desktop.killSession(connectionId, name);
      const closed = terminals.filter((item) => item.name === name && item.connectionId === connectionId);
      await Promise.all(closed.map((item) => desktop.closeTerminal(item.id).catch(() => undefined)));
      const remaining = terminals.filter((item) => item.name !== name || item.connectionId !== connectionId);
      setTerminals(remaining);
      setActiveId((current) => closed.some((item) => item.key === current) ? remaining[0]?.key ?? null : current);
      await refresh();
    }
    catch (error) { setMessage(errorMessage(error)); }
  }

  async function closeTerminal(key: string) {
    const id = terminals.find(t => t.key === key)?.id;
    if (id) await desktop.closeTerminal(id).catch(() => undefined);
    setTerminals((current) => current.filter((item) => item.key !== key));
    if (activeId === key) setActiveId(terminals.find((item) => item.key !== key)?.key ?? null);
    void refresh();
  }

  async function disconnect() {
    if (selected) await removeServer(selected); setSessions([]); setMessage('已断开；持久会话仍在服务器运行。');
  }

  const login = <main className={`login-shell ${servers.length ? 'connection-overlay' : ''}`}>
    {servers.length > 0 && <button className="close-connections" onClick={() => setShowConnections(false)}>返回工作区</button>}
    <section className="brand-panel"><div className="brand-mark"><img src="./appicon.png" alt="" /></div><h1>Nohop Codex</h1><p>关掉电脑，任务继续跑。回来后点击原来的会话，立即接着工作。</p><div className="feature"><SquareTerminal size={18} /><span>Linux：tmux / screen</span></div><div className="feature"><Server size={18} /><span>Windows：原生 ConPTY</span></div></section>
    <section className="connect-card"><div className="connect-title"><div><h2>Remote SSH</h2><small>选择 ~/.ssh/config 中的主机</small></div><button className="icon" title="编辑 SSH config" onClick={() => void editConfig()}><FilePenLine size={18} /></button></div><button className="primary add-host-button" disabled={busy} onClick={() => { setAddError(''); setShowAddHost(true); }}><Plus size={17} />添加 SSH 主机</button><div className="host-list">{hosts.map((item) => <button className="host-card" key={item.alias} disabled={busy} onClick={() => void connectHost(item.alias)}><Server size={18} /><span><strong>{item.alias}</strong><small>{item.user ? `${item.user}@` : ''}{item.host}:{item.port}</small></span><ChevronRight size={17} /></button>)}{hosts.length === 0 && <div className="hosts-empty">SSH config 中还没有主机<br/><button disabled={busy} onClick={() => { setAddError(''); setShowAddHost(true); }}>输入 SSH 命令添加</button></div>}</div><button className="manual-toggle" onClick={() => setShowManual((value) => !value)}>{showManual ? '收起手动连接' : '手动连接…'}</button>{showManual && <form className="manual-form" onSubmit={connect}><label>主机<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="server.example.com" required /></label><div className="row"><label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="port">端口<input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label></div><label>认证方式<select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}><option value="password">密码</option><option value="privateKey">私钥</option><option value="agent">SSH Agent</option></select></label>{authMethod === 'password' && <label>密码（留空则连接时弹窗）<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}{authMethod === 'privateKey' && <><label>私钥<div className="file-field"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} /><button type="button" onClick={async () => { const value = await desktop.choosePrivateKey(); if (value) setPrivateKeyPath(value); }}><KeyRound size={16} /></button></div></label><label>私钥口令（可选）<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /></label></>}<button className="primary" disabled={busy}>{busy ? '连接中…' : '连接'}</button></form>}{message && <p className="message">{message}</p>}</section>
    {showAddHost && <div className="modal-backdrop"><form className="credential-modal add-host-modal" onSubmit={addHost}>
      <h3>添加 SSH 主机</h3>
      <p>输入平时使用的 SSH 命令，保存后立即连接。支持密码、私钥和 SSH Agent；需要密码或口令时会弹窗。</p>
      <label>SSH 命令<input autoFocus required disabled={busy} value={sshCommand} onChange={(event) => setSSHCommand(event.target.value)} placeholder="ssh ubuntu@example.com -p 22" /></label>
      <small>指定密钥：ssh -i ~/.ssh/id_ed25519 ubuntu@example.com<br />支持 -p、-l、-i、-J；含空格的路径请加引号。</small>
      <label>主机别名<input required disabled={busy} value={sshAlias} onChange={(event) => setSSHAlias(event.target.value)} placeholder="例如：工作服务器" /></label>
      <small>保存到 ~/.ssh/config，以后可从主机列表直接连接。</small>
      {addError && <p className="message" role="alert">{addError}</p>}
      <div><button type="button" disabled={busy} onClick={() => setShowAddHost(false)}>取消</button><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存并连接'}</button></div>
    </form></div>}
    {configText !== null && <div className="modal-backdrop"><section className="config-modal"><header><div><h2>SSH config</h2><small>~/.ssh/config</small></div><button className="icon" onClick={() => setConfigText(null)}><X size={18}/></button></header><textarea value={configText} onChange={(event) => setConfigText(event.target.value)} spellCheck={false} placeholder={'Host my-server\n  HostName 192.168.1.10\n  User ubuntu\n  IdentityFile ~/.ssh/id_ed25519'} /><footer><button onClick={() => setConfigText(null)}>取消</button><button className="primary" onClick={() => void saveConfig()}>保存配置</button></footer></section></div>}

  </main>;

  const workspace = <main className={`workspace ${sidebarOpen ? 'sidebar-open' : ''}`}><button className="sidebar-shade" aria-label="关闭服务器列表" onClick={() => setSidebarOpen(false)} /><aside><div className="server-list"><button className="primary" onClick={() => setShowConnections(true)}><Plus size={16}/>连接其他服务器</button>{servers.map(s => <div className={`server-row ${selected === s.input.connectionId ? 'selected' : ''}`} key={s.input.connectionId}><button onClick={() => setSelected(s.input.connectionId)}><strong>{s.input.alias || s.input.host}</strong><small>{s.status}</small></button>{s.status !== '已连接' && <button title="重试连接" onClick={() => recover(s.input)}><RefreshCw size={14}/></button>}</div>)}</div><header><div><span className="eyebrow">{server?.status}</span><strong>{server?.input.alias || server?.input.host}</strong><small>{connected?.platform ?? '恢复连接中'} · {connected?.backend ?? ''}</small></div><button className="icon" title="断开连接" onClick={() => void disconnect()}><LogOut size={18} /></button></header><section className="new-session"><label>会话名称<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label><label>工作目录（可选）<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={connected?.platform === 'windows' ? 'C:\\work' : '/home/user/work'} /></label>{connected?.backend === 'none' && <p className="backend-warning">远端未安装 tmux 或 screen，无法创建持久会话。请先在服务器安装 tmux 后重新连接。</p>}<button className="primary" disabled={busy || (!connected || connected.backend === 'none')} title={!connected ? '正在恢复连接' : connected.backend === 'none' ? '远端需要安装 tmux 或 screen' : undefined} onClick={() => { setSidebarOpen(false); void open(newName); }}><Plus size={17} /> {!connected ? '等待恢复连接' : connected.backend === 'none' ? '需要安装 tmux / screen' : busy ? '正在进入…' : '新建并进入'}</button></section><div className="session-heading"><span>远端会话</span><button className="icon" onClick={() => void refresh()}><RefreshCw size={16} /></button></div><div className="session-list">{sessions.map((session) => <div className="session-card" key={session.name} onClick={() => { setSidebarOpen(false); void open(session.name); }}><SquareTerminal size={18} /><div><strong>{session.name}</strong><small>{session.attached ? '已连接' : '等待重新进入'}{session.windows ? ` · ${session.windows} 窗口` : ''}</small></div><button className="delete" title="终止远端会话和其中的进程" onClick={(event) => { event.stopPropagation(); void kill(session.name); }}><Trash2 size={15} /></button></div>)}{sessions.length === 0 && <p className="empty">还没有持久会话</p>}</div></aside><section className="terminal-area"><nav>{terminals.map((item) => <div key={item.id} className={`terminal-tab ${activeId === item.key ? 'active' : ''}`}><button className="tab-select" onClick={() => { setActiveId(item.key); setSelected(item.connectionId); }}><span>{servers.find(s => s.input.connectionId === item.connectionId)?.input.alias || servers.find(s => s.input.connectionId === item.connectionId)?.input.host} · {item.name}</span></button><button className="tab-action terminate" title="终止远端会话和其中的进程" onClick={() => void kill(item.name, item.connectionId)}><Trash2 size={13}/></button><button className="tab-action" title="关闭标签（远端继续运行）" onClick={() => void closeTerminal(item.key)}><X size={14}/></button></div>)}</nav><div className="layout-toolbar"><button className="mobile-menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}>服务器 / 会话</button><button disabled={!connected} onClick={() => { if (selected && server) setFileServer({ id: selected, name: server.input.alias || server.input.host }); }}>SFTP 文件</button><span>终端布局</span>{([['single', '单屏'], ['columns', '左右分屏'], ['rows', '上下分屏'], ['grid', '网格']] as const).map(([value, label]) => <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>{label}</button>)}</div><div className={`terminal-stack layout-${layout}`}>{terminals.map((item) => <div key={item.key} className={`terminal-pane ${(layout !== 'single' || activeId === item.key || (!terminals.some(t => t.key === activeId) && item.key === terminals[0]?.key)) ? 'visible' : ''} ${activeId === item.key ? 'focused' : ''}`}><div className="pane-title">{servers.find(s => s.input.connectionId === item.connectionId)?.input.alias || servers.find(s => s.input.connectionId === item.connectionId)?.input.host} · {item.name}</div>{item.id ? <TerminalView item={item} focused={activeId === item.key} active={layout !== 'single' || activeId === item.key || (!terminals.some(t => t.key === activeId) && item.key === terminals[0]?.key)} onFocus={() => { setActiveId(item.key); setSelected(item.connectionId); }} /> : <div className="terminal-empty">等待恢复远端会话…</div>}</div>)}{terminals.length === 0 && <div className="terminal-empty"><SquareTerminal size={48} /><h2>选择一个会话</h2><p>点击左侧会话即可进入；关闭标签不会结束远端任务。使用垃圾桶可终止会话。</p></div>}</div><div className="status">{message || '截图粘贴：Ctrl+Shift+V / Shift+Insert / 右键粘贴 · 图片上传到当前服务器后插入路径'} </div></section></main>;
  return <>{fileServer && <FileBrowser key={fileServer.id} connectionId={fileServer.id} serverName={fileServer.name} onBack={() => setFileServer(null)} />}<div style={{ display: fileServer ? 'none' : 'contents' }}>{servers.length > 0 && workspace}{(servers.length === 0 || showConnections) && login}</div>    {credential && <div className="modal-backdrop credential-layer"><form className="credential-modal" onSubmit={(event) => { event.preventDefault(); answerCredential(false); }}><KeyRound size={24}/><h3>{credential.kind === 'hostkey' ? '首次连接服务器' : credential.kind === 'passphrase' ? 'SSH 私钥口令' : 'SSH 认证'}</h3><p>{credential.prompt}</p>{credential.kind !== 'hostkey' && <input autoFocus type={credential.secret ? 'password' : 'text'} value={credentialValue} onChange={(event) => setCredentialValue(event.target.value)} />}<div><button type="button" onClick={() => answerCredential(true)}>取消</button><button className="primary">{credential.kind === 'hostkey' ? '信任并连接' : '确认'}</button></div></form></div>}
  </>;
}
