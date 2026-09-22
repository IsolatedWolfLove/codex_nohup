import { desktop, decodeTerminalData } from './desktop-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { KeyRound, LogOut, MonitorUp, Plus, RefreshCw, Server, SquareTerminal, Trash2, X } from 'lucide-react';
import type { AuthMethod, ConnectionInfo, PersistentSession, TerminalEvent } from '../../shared/contracts';

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
    try { if (!await desktop.confirmKill(name)) return; await desktop.killSession(name); await refresh(); }
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
    <section className="brand-panel"><div className="brand-mark"><MonitorUp size={28} /></div><h1>Nohop Codex</h1><p>关掉电脑，任务继续跑。回来后点击原来的会话，立即接着工作。</p><div className="feature"><SquareTerminal size={18} /><span>Linux：tmux / screen</span></div><div className="feature"><Server size={18} /><span>Windows：原生 ConPTY</span></div></section>
    <form className="connect-card" onSubmit={connect}><h2>连接服务器</h2><label>主机<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="server.example.com" required /></label><div className="row"><label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="port">端口<input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label></div><label>认证方式<select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}><option value="password">密码</option><option value="privateKey">私钥</option><option value="agent">SSH Agent</option></select></label>{authMethod === 'password' && <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}{authMethod === 'privateKey' && <><label>私钥<div className="file-field"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} /><button type="button" onClick={async () => { const value = await desktop.choosePrivateKey(); if (value) setPrivateKeyPath(value); }}><KeyRound size={16} /></button></div></label><label>私钥口令（可选）<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /></label></>}<button className="primary" disabled={busy}>{busy ? '连接中…' : '连接'}</button>{message && <p className="message">{message}</p>}</form>
  </main>;

  return <main className="workspace"><aside><header><div><span className="eyebrow">CONNECTED</span><strong>{connected.host}</strong><small>{connected.platform} · {connected.backend}</small></div><button className="icon" title="断开连接" onClick={() => void disconnect()}><LogOut size={18} /></button></header><section className="new-session"><label>会话名称<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label><label>工作目录（可选）<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={connected.platform === 'windows' ? 'C:\\work' : '/home/user/work'} /></label><button className="primary" disabled={busy || connected.backend === 'none'} onClick={() => void open(newName)}><Plus size={17} /> 新建并进入</button></section><div className="session-heading"><span>远端会话</span><button className="icon" onClick={() => void refresh()}><RefreshCw size={16} /></button></div><div className="session-list">{sessions.map((session) => <div className="session-card" key={session.name} onClick={() => void open(session.name)}><SquareTerminal size={18} /><div><strong>{session.name}</strong><small>{session.attached ? '已连接' : '等待重新进入'}{session.windows ? ` · ${session.windows} 窗口` : ''}</small></div><button className="delete" title="结束会话" onClick={(event) => { event.stopPropagation(); void kill(session.name); }}><Trash2 size={15} /></button></div>)}{sessions.length === 0 && <p className="empty">还没有持久会话</p>}</div></aside><section className="terminal-area"><nav>{terminals.map((item) => <button key={item.id} className={activeId === item.id ? 'active' : ''} onClick={() => setActiveId(item.id)}><span>{item.name}</span><X size={14} onClick={(event) => { event.stopPropagation(); void closeTerminal(item.id); }} /></button>)}</nav><div className="terminal-stack">{terminals.map((item) => <TerminalView key={item.id} item={item} active={activeId === item.id} />)}{terminals.length === 0 && <div className="terminal-empty"><SquareTerminal size={48} /><h2>选择一个会话</h2><p>点击左侧会话即可进入；关闭这个窗口不会结束远端任务。</p></div>}</div>{message && <div className="status">{message}</div>}</section></main>;
}
