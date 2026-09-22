import { desktop, decodeTerminalData } from './desktop-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ChevronRight, FilePenLine, KeyRound, LogOut, Plus, RefreshCw, Server, SquareTerminal, Trash2, X } from 'lucide-react';
import type { AuthMethod, ConnectionInfo, CredentialRequest, PersistentSession, SSHHost, TerminalEvent } from '../../shared/contracts';

interface OpenTerminal { id: string; name: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function TerminalView({ item, active }: { item: OpenTerminal; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = new Terminal({ cursorBlink: true, convertEol: false, fontFamily: 'JetBrains Mono, Cascadia Code, monospace', fontSize: 14, theme: { background: '#080b10', foreground: '#d7e0ea', cursor: '#64d8cb', selectionBackground: '#264b52' } });
    const addon = new FitAddon();
    instance.loadAddon(addon); instance.open(host.current); addon.fit(); instance.focus();
    terminal.current = instance; fit.current = addon;
    instance.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const copy = (event.ctrlKey && event.shiftKey && event.code === 'KeyC') || (event.ctrlKey && event.code === 'Insert');
      const paste = (event.ctrlKey && event.shiftKey && event.code === 'KeyV') || (event.shiftKey && event.code === 'Insert');
      if (copy) {
        const selected = instance.getSelection();
        if (selected) void desktop.clipboardSetText(selected).catch((error) => instance.writeln(`\r\n${errorMessage(error)}`));
        return false;
      }
      if (paste) {
        void desktop.clipboardGetText().then((value) => {
          if (value) return desktop.writeTerminal(item.id, value);
        }).catch((error) => instance.writeln(`\r\n${errorMessage(error)}`));
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
    const observer = new ResizeObserver(() => {
      addon.fit();
      if (instance.cols > 0 && instance.rows > 0) void desktop.resizeTerminal(item.id, instance.cols, instance.rows).catch(() => undefined);
    });
    observer.observe(host.current);
    return () => { observer.disconnect(); unsubscribe(); input.dispose(); instance.dispose(); terminal.current = null; };
  }, [item.id]);

  useEffect(() => { if (active) { fit.current?.fit(); terminal.current?.focus(); } }, [active]);
  return <div ref={host} className={`terminal-host ${active ? 'active' : ''}`} />;
}

export function App() {
  const [connected, setConnected] = useState<ConnectionInfo | null>(null);
  const [sessions, setSessions] = useState<PersistentSession[]>([]);
  const [terminals, setTerminals] = useState<OpenTerminal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [host, setHost] = useState(''); const [port, setPort] = useState(22); const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password'); const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState(''); const [passphrase, setPassphrase] = useState('');
  const [newName, setNewName] = useState('nohop-work'); const [cwd, setCwd] = useState('');
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [configText, setConfigText] = useState<string | null>(null);
  const [credential, setCredential] = useState<CredentialRequest | null>(null);
  const [credentialValue, setCredentialValue] = useState('');

  const loadHosts = useCallback(async () => {
    try { setHosts(await desktop.listSSHHosts()); } catch (error) { setMessage(errorMessage(error)); }
  }, []);

  useEffect(() => { void loadHosts(); }, [loadHosts]);
  useEffect(() => {
    const offCredential = desktop.onCredentialRequest((request) => { setCredentialValue(''); setCredential(request); });
    const offUrl = desktop.onAuthUrl(() => setMessage('已在浏览器打开认证页面，完成 approve 后会自动继续连接…'));
    return () => { offCredential(); offUrl(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!connected) return;
    try { setSessions(await desktop.listSessions()); setMessage(''); }
    catch (error) { setMessage(errorMessage(error)); }
  }, [connected]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('正在连接…');
    try {
      const info = await desktop.connect({ host, port, username, authMethod, password, privateKeyPath, passphrase });
      setConnected(info); setPassword(''); setMessage(info.backend === 'none' ? '已连接，但 Linux 服务器未安装 tmux/screen。' : '已连接');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function connectHost(alias: string) {
    setBusy(true); setMessage(`正在连接 ${alias}…`);
    try {
      const info = await desktop.connect({ alias, host: alias, port: 22, username: '', authMethod: 'auto' });
      setConnected(info); setMessage(info.backend === 'none' ? '已连接，但 Linux 服务器未安装 tmux/screen。' : '已连接');
    } catch (error) { setMessage(errorMessage(error)); }
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
    setCredential(null); setCredentialValue('');
  }

  async function open(name: string) {
    if (terminals.some((terminal) => terminal.name === name)) {
      setActiveId(terminals.find((terminal) => terminal.name === name)!.id); return;
    }
    setBusy(true); setMessage(`正在进入 ${name}…`);
    try {
      const result = await desktop.openSession({ name, cwd });
      const item = { id: result.terminalId, name: result.sessionName };
      setTerminals((current) => [...current, item]); setActiveId(item.id); setMessage('');
      window.setTimeout(() => void refresh(), 500);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function kill(name: string) {
    try {
      if (!await desktop.confirmKill(name)) return;
      await desktop.killSession(name);
      const closed = terminals.filter((item) => item.name === name);
      await Promise.all(closed.map((item) => desktop.closeTerminal(item.id).catch(() => undefined)));
      const remaining = terminals.filter((item) => item.name !== name);
      setTerminals(remaining);
      setActiveId((current) => closed.some((item) => item.id === current) ? remaining[0]?.id ?? null : current);
      await refresh();
    }
    catch (error) { setMessage(errorMessage(error)); }
  }

  async function closeTerminal(id: string) {
    await desktop.closeTerminal(id).catch(() => undefined);
    setTerminals((current) => current.filter((item) => item.id !== id));
    if (activeId === id) setActiveId(terminals.find((item) => item.id !== id)?.id ?? null);
    void refresh();
  }

  async function disconnect() {
    await desktop.disconnect(); setConnected(null); setSessions([]); setTerminals([]); setActiveId(null); setMessage('已断开；持久会话仍在服务器运行。');
  }

  if (!connected) return <main className="login-shell">
    <section className="brand-panel"><div className="brand-mark"><img src="./appicon.png" alt="" /></div><h1>Nohop Codex</h1><p>关掉电脑，任务继续跑。回来后点击原来的会话，立即接着工作。</p><div className="feature"><SquareTerminal size={18} /><span>Linux：tmux / screen</span></div><div className="feature"><Server size={18} /><span>Windows：原生 ConPTY</span></div></section>
    <section className="connect-card"><div className="connect-title"><div><h2>Remote SSH</h2><small>选择 ~/.ssh/config 中的主机</small></div><button className="icon" title="编辑 SSH config" onClick={() => void editConfig()}><FilePenLine size={18} /></button></div><div className="host-list">{hosts.map((item) => <button className="host-card" key={item.alias} disabled={busy} onClick={() => void connectHost(item.alias)}><Server size={18} /><span><strong>{item.alias}</strong><small>{item.user ? `${item.user}@` : ''}{item.host}:{item.port}</small></span><ChevronRight size={17} /></button>)}{hosts.length === 0 && <div className="hosts-empty">SSH config 中还没有主机<br/><button onClick={() => void editConfig()}>创建配置</button></div>}</div><button className="manual-toggle" onClick={() => setShowManual((value) => !value)}>{showManual ? '收起手动连接' : '手动连接…'}</button>{showManual && <form className="manual-form" onSubmit={connect}><label>主机<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="server.example.com" required /></label><div className="row"><label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="port">端口<input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label></div><label>认证方式<select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}><option value="password">密码</option><option value="privateKey">私钥</option><option value="agent">SSH Agent</option></select></label>{authMethod === 'password' && <label>密码（留空则连接时弹窗）<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}{authMethod === 'privateKey' && <><label>私钥<div className="file-field"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} /><button type="button" onClick={async () => { const value = await desktop.choosePrivateKey(); if (value) setPrivateKeyPath(value); }}><KeyRound size={16} /></button></div></label><label>私钥口令（可选）<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /></label></>}<button className="primary" disabled={busy}>{busy ? '连接中…' : '连接'}</button></form>}{message && <p className="message">{message}</p>}</section>
    {configText !== null && <div className="modal-backdrop"><section className="config-modal"><header><div><h2>SSH config</h2><small>~/.ssh/config</small></div><button className="icon" onClick={() => setConfigText(null)}><X size={18}/></button></header><textarea value={configText} onChange={(event) => setConfigText(event.target.value)} spellCheck={false} placeholder={'Host my-server\n  HostName 192.168.1.10\n  User ubuntu\n  IdentityFile ~/.ssh/id_ed25519'} /><footer><button onClick={() => setConfigText(null)}>取消</button><button className="primary" onClick={() => void saveConfig()}>保存配置</button></footer></section></div>}
    {credential && <div className="modal-backdrop credential-layer"><form className="credential-modal" onSubmit={(event) => { event.preventDefault(); answerCredential(false); }}><KeyRound size={24}/><h3>{credential.kind === 'hostkey' ? '首次连接服务器' : credential.kind === 'passphrase' ? 'SSH 私钥口令' : 'SSH 认证'}</h3><p>{credential.prompt}</p>{credential.kind !== 'hostkey' && <input autoFocus type={credential.secret ? 'password' : 'text'} value={credentialValue} onChange={(event) => setCredentialValue(event.target.value)} />}<div><button type="button" onClick={() => answerCredential(true)}>取消</button><button className="primary">{credential.kind === 'hostkey' ? '信任并连接' : '确认'}</button></div></form></div>}
  </main>;

  return <main className="workspace"><aside><header><div><span className="eyebrow">CONNECTED</span><strong>{connected.host}</strong><small>{connected.platform} · {connected.backend}</small></div><button className="icon" title="断开连接" onClick={() => void disconnect()}><LogOut size={18} /></button></header><section className="new-session"><label>会话名称<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label><label>工作目录（可选）<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={connected.platform === 'windows' ? 'C:\\work' : '/home/user/work'} /></label>{connected.backend === 'none' && <p className="backend-warning">远端未安装 tmux 或 screen，无法创建持久会话。请先在服务器安装 tmux 后重新连接。</p>}<button className="primary" disabled={busy || connected.backend === 'none'} title={connected.backend === 'none' ? '远端需要安装 tmux 或 screen' : undefined} onClick={() => void open(newName)}><Plus size={17} /> {connected.backend === 'none' ? '需要安装 tmux / screen' : busy ? '正在进入…' : '新建并进入'}</button></section><div className="session-heading"><span>远端会话</span><button className="icon" onClick={() => void refresh()}><RefreshCw size={16} /></button></div><div className="session-list">{sessions.map((session) => <div className="session-card" key={session.name} onClick={() => void open(session.name)}><SquareTerminal size={18} /><div><strong>{session.name}</strong><small>{session.attached ? '已连接' : '等待重新进入'}{session.windows ? ` · ${session.windows} 窗口` : ''}</small></div><button className="delete" title="终止远端会话和其中的进程" onClick={(event) => { event.stopPropagation(); void kill(session.name); }}><Trash2 size={15} /></button></div>)}{sessions.length === 0 && <p className="empty">还没有持久会话</p>}</div></aside><section className="terminal-area"><nav>{terminals.map((item) => <div key={item.id} className={`terminal-tab ${activeId === item.id ? 'active' : ''}`}><button className="tab-select" onClick={() => setActiveId(item.id)}><span>{item.name}</span></button><button className="tab-action terminate" title="终止远端会话和其中的进程" onClick={() => void kill(item.name)}><Trash2 size={13}/></button><button className="tab-action" title="关闭标签（远端继续运行）" onClick={() => void closeTerminal(item.id)}><X size={14}/></button></div>)}</nav><div className="terminal-stack">{terminals.map((item) => <TerminalView key={item.id} item={item} active={activeId === item.id} />)}{terminals.length === 0 && <div className="terminal-empty"><SquareTerminal size={48} /><h2>选择一个会话</h2><p>点击左侧会话即可进入；关闭标签不会结束远端任务。使用垃圾桶可终止会话。</p></div>}</div>{message && <div className="status">{message}</div>}</section></main>;
}
