import { TerminalTab } from './TerminalTab';
import { detachTerminal, syncDetached } from './native-runtime';
import { RemotePathInput } from './RemotePathInput';
import { sessionDirectory } from './path-completion';
import { PortForwards } from './PortForwards';
import { FileBrowser } from './FileBrowser';
import { MobileKeys } from './MobileKeys';
import { desktop, decodeTerminalData } from './desktop-api';
import { useWorkspace, type OpenTerminal } from './use-workspace';
import { bindTerminalScrolling } from './terminal-scrolling';
import { bindTerminalLayout } from './terminal-layout';
import { bindTerminalRendering } from './terminal-rendering';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

let lastCellSize = { width: 8.4, height: 18 };
const baseTerminalTheme = {
  foreground: '#eee6fa', cursor: '#f5b4d5', cursorAccent: '#151221', selectionBackground: '#c4a7e74d',
  black: '#282234', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#cba6f7', cyan: '#94e2d5', white: '#ddd6ee',
  brightBlack: '#9385a8', brightRed: '#ffadc1', brightGreen: '#c2f0b6', brightYellow: '#ffedc4', brightBlue: '#b4d2ff', brightMagenta: '#e0c2ff', brightCyan: '#b2f0e6', brightWhite: '#ffffff',
};
import { ChevronRight, Copy, FilePenLine, KeyRound, LogOut, ClipboardPaste, Plus, RefreshCw, Server, SquareTerminal, Trash2, X } from 'lucide-react';
import type { RemoteDirectory, AuthMethod, CredentialRequest, PersistentSession, SSHHost, SSHKeyInfo, TerminalEvent, TerminalScrollState } from '../../shared/contracts';


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TerminalView({ item, active, focused, lowLatency = false, onFocus }: { item: OpenTerminal; active: boolean; focused: boolean; lowLatency?: boolean; onFocus: () => void }) {
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
      if (terminal.current === instance) instance?.paste("'" + path.replaceAll("'", (item.backend === 'conpty' || item.backend === 'local') ? "''" : "'\\''") + "' ");
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
    const instance = new Terminal({
      cols: item.cols ?? 120,
      rows: item.rows ?? 32,
      cursorBlink: !lowLatency,
      convertEol: false,
      fontFamily: 'JetBrains Mono, Cascadia Code, monospace',
      fontSize: 14,
      lineHeight: 1.12,
      allowTransparency: !lowLatency,
      theme: { ...baseTerminalTheme, background: lowLatency ? '#151221' : '#00000000' },
    });
    const addon = new FitAddon();
    instance.loadAddon(addon); instance.open(surface.current);
    let webglActive = false;
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webglActive = false;
        webgl?.dispose();
        webgl = null;
      });
      instance.loadAddon(webgl);
      webglActive = true;
    } catch {
      webglActive = false;
      webgl = null;
    }
    const rendering = bindTerminalRendering(instance,
      () => !webglActive && activeRef.current && document.visibilityState === 'visible');
    let frame = 0;
    let disposed = false;
    const initialSynced = item.cols && item.rows ? `${item.cols}:${item.rows}` : '';
    const layout = bindTerminalLayout(() => {
      if (!activeRef.current || !surface.current?.clientWidth || !surface.current.clientHeight) return null;
      addon.fit();
      const cell = (instance as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core?._renderService?.dimensions?.css?.cell;
      if (cell?.width && cell?.height) lastCellSize = { width: cell.width, height: cell.height };
      return { cols: instance.cols, rows: instance.rows };
    }, (cols, rows) => desktop.resizeTerminal(item.id, cols, rows),
    () => desktop.readyTerminal(item.id), rendering.refresh,
    (error) => setScrollError(errorMessage(error)), initialSynced);
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layout.fit());
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
      if (event.type === 'exit') instance.writeln('\r\n\x1b[90m[终端已关闭，可从会话列表重新进入仍在运行的会话]\x1b[0m');
    });
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(surface.current);
    // Restoring a minimized window can invalidate the canvas without changing size.
    const onVisible = () => { if (document.visibilityState === 'visible') scheduleFit(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', scheduleFit);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      layout.dispose();
      rendering.dispose();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', scheduleFit);
      scroller.dispose(); scrolling.current = null;
      webgl?.dispose();
      unsubscribe(); input.dispose(); instance.dispose(); terminal.current = null; fit.current = null;
    };
  }, [item.id, item.backend, copySelection, pasteClipboard]);

  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    instance.options.cursorBlink = !lowLatency;
    instance.options.allowTransparency = !lowLatency;
    instance.options.theme = { ...baseTerminalTheme, background: lowLatency ? '#151221' : '#00000000' };
  }, [lowLatency]);

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
    <MobileKeys send={data => { terminal.current?.input(data, true); terminal.current?.focus(); }} paste={pasteClipboard} copy={copySelection} />
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
  const [detached, setDetached] = useState<Set<string>>(new Set());
  const detaching = useRef(new Set<string>());
  useEffect(() => window.runtime.EventsOn('terminal:docked', (key: string) => {
    setDetached(current => { const next = new Set(current); next.delete(key); return next; });
    setActiveId(key);
  }), []);
  async function detach(item: OpenTerminal) {
    if (detaching.current.has(item.key) || !item.id) return;
    detaching.current.add(item.key);
    setDetached(current => new Set(current).add(item.key));
    try { await detachTerminal(JSON.stringify(item)); }
    catch (error) { setDetached(current => { const next = new Set(current); next.delete(item.key); return next; }); setMessage(errorMessage(error)); }
    finally { detaching.current.delete(item.key); }
  }
  const opening = useRef(new Set<string>());

  const [forwardServer, setForwardServer] = useState<{ id: string; name: string } | null>(null);
  const [fileServer, setFileServer] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wallpaperShade, setWallpaperShade] = useState(() => {
    try { const saved = localStorage.getItem('nohop.wallpaperShade'); const value = saved === null ? 45 : Number(saved); return Number.isFinite(value) ? Math.min(90, Math.max(15, value)) : 45; } catch { return 45; }
  });
  useEffect(() => { try { localStorage.setItem('nohop.wallpaperShade', String(wallpaperShade)); } catch { /* Storage may be unavailable in a webview. */ } }, [wallpaperShade]);
  const [lowLatency, setLowLatency] = useState(() => {
    try { return localStorage.getItem('nohop.lowLatency') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nohop.lowLatency', lowLatency ? '1' : '0'); } catch { /* Storage may be unavailable in a webview. */ }
    document.body.classList.toggle('low-latency', lowLatency);
  }, [lowLatency]);
  const stackRef = useRef<HTMLDivElement>(null);
  const estimateGrid = useCallback(() => {
    const stack = stackRef.current;
    if (!stack || !stack.clientWidth || !stack.clientHeight) return undefined;
    const existing = stack.querySelector<HTMLElement>('.terminal-surface');
    const width = existing?.clientWidth || Math.max(160, stack.clientWidth - 56);
    const height = existing?.clientHeight || Math.max(80, stack.clientHeight - 66);
    return {
      cols: Math.max(20, Math.min(500, Math.floor(width / lastCellSize.width))),
      rows: Math.max(5, Math.min(500, Math.floor(height / lastCellSize.height))),
    };
  }, []);
  const [message, setMessage] = useState('');
  const { servers, terminals, setTerminals, selected, setSelected, activeId, setActiveId, layout, setLayout, addServer, removeServer, recover } = useWorkspace(setMessage, estimateGrid);
  useEffect(() => {
    detached.forEach(key => {
      const item = terminals.find(t => t.key === key);
      void syncDetached(JSON.stringify(item ?? { key, closed: true })).catch(error => setMessage(errorMessage(error)));
    });
  }, [terminals, detached]);
  const server = servers.find(s => s.input.connectionId === selected);
  const connected = server?.info ?? null;
  const [sessions, setSessions] = useState<PersistentSession[]>([]);
  const [showConnections, setShowConnections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState(''); const [port, setPort] = useState(22); const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password'); const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState(''); const [passphrase, setPassphrase] = useState('');
  const [newName, setNewName] = useState('nohop-work'); const [cwd, setCwd] = useState('~');
  const [homeDirectory, setHomeDirectory] = useState<RemoteDirectory | null>(null);
  const homeFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    setCwd('~'); setHomeDirectory(null); homeFetchedFor.current = null;
  }, [selected, connected, server?.input.local]);
  const ensureHomeDirectory = useCallback(() => {
    if (!selected || !connected || server?.input.local || homeFetchedFor.current === selected) return;
    const targetId = selected;
    homeFetchedFor.current = targetId;
    void desktop.listFiles(targetId, '').then(directory => {
      if (selectedRef.current === targetId) setHomeDirectory(directory);
    }).catch(() => { /* Manual paths remain available without SFTP. */ });
  }, [selected, connected, server?.input.local]);
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKeyInfo[]>([]);
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNotice, setKeyNotice] = useState('');
  const [genKeyName, setGenKeyName] = useState('id_ed25519');
  const [genKeyPassphrase, setGenKeyPassphrase] = useState('');
  const [importKeyName, setImportKeyName] = useState('');
  const [importKeyContent, setImportKeyContent] = useState('');
  const [importKeyPassphrase, setImportKeyPassphrase] = useState('');
  const [showAddHost, setShowAddHost] = useState(false);
  const [sshCommand, setSSHCommand] = useState('');
  const [sshAlias, setSSHAlias] = useState('');
  const [addHostKeyPath, setAddHostKeyPath] = useState('');
  const [addError, setAddError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [configText, setConfigText] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialRequest[]>([]);
  const credential = credentials[0];
  const [credentialValue, setCredentialValue] = useState('');

  const isAndroid = import.meta.env.MODE === 'android';
  const loadHosts = useCallback(async () => {
    try { setHosts(await desktop.listSSHHosts()); } catch (error) { setMessage(errorMessage(error)); }
  }, []);
  const loadKeys = useCallback(async () => {
    if (!isAndroid) return [];
    try {
      const keys = await desktop.listSSHKeys();
      setSSHKeys(keys);
      return keys;
    } catch { return []; }
  }, [isAndroid]);

  useEffect(() => { void loadHosts(); if (isAndroid) void loadKeys(); }, [loadHosts, loadKeys, isAndroid]);
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

  async function connectLocal() {
    if (busy) return;
    const existing = servers.find(item => item.input.local);
    if (existing) { setSelected(existing.input.connectionId); setShowConnections(false); return; }
    setBusy(true); setMessage('正在打开本机…');
    try {
      const connectionId = crypto.randomUUID();
      const info = await addServer({ connectionId, local: true, alias: '本机', host: '本机', port: 22, username: '', authMethod: 'auto' });
      if (!info) return;
      setShowConnections(false);
      if (info.backend === 'none') { setMessage('本机未安装 tmux / screen，请安装后重新连接。'); return; }
      const grid = estimateGrid();
      const opened = await desktop.openSession({ connectionId, name: 'nohop-work', cols: grid?.cols, rows: grid?.rows });
      const item = { key: crypto.randomUUID(), connectionId, cwd: '', id: opened.terminalId, name: opened.sessionName, backend: opened.backend, cols: grid?.cols, rows: grid?.rows };
      setTerminals(current => [...current, item]); setActiveId(item.key); setMessage('');
      const currentSessions = await desktop.listSessions(connectionId);
      if (selectedRef.current === connectionId) setSessions(currentSessions);
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
      const command = isAndroid && addHostKeyPath && !/(?:^|\s)-i(?:\s|$)/.test(sshCommand)
        ? `${sshCommand.trim()} -i "${addHostKeyPath}"`
        : sshCommand;
      await desktop.addSSHHost(alias, command);
      setShowAddHost(false); setSSHCommand(''); setSSHAlias(''); setAddHostKeyPath('');
      await loadHosts();
      await connectHost(alias);
    } catch (error) { setAddError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function openKeyManager() {
    setKeyNotice('');
    setShowKeyManager(true);
    const keys = await loadKeys();
    setGenKeyName(keys.some(k => k.name === 'id_ed25519') ? 'nohop_ed25519' : 'id_ed25519');
  }

  async function generateKey(event: React.FormEvent) {
    event.preventDefault();
    if (keyBusy) return;
    setKeyBusy(true); setKeyNotice('');
    try {
      const created = await desktop.generateSSHKey(genKeyName.trim() || 'id_ed25519', genKeyPassphrase, 'nohop-codex');
      setGenKeyPassphrase('');
      const keys = await loadKeys();
      setGenKeyName(keys.some(k => k.name === 'id_ed25519') ? 'nohop_ed25519' : 'id_ed25519');
      setKeyNotice(`已生成密钥 ${created.name}；点击「复制公钥」贴到服务器 ~/.ssh/authorized_keys 即可连接。`);
    } catch (error) { setKeyNotice(errorMessage(error)); }
    finally { setKeyBusy(false); }
  }

  async function importKey(event: React.FormEvent) {
    event.preventDefault();
    if (keyBusy) return;
    setKeyBusy(true); setKeyNotice('');
    try {
      const saved = await desktop.importSSHKey(importKeyName.trim(), importKeyContent, importKeyPassphrase);
      setImportKeyName(''); setImportKeyContent(''); setImportKeyPassphrase('');
      await loadKeys();
      setKeyNotice(`已保存本机私钥 ${saved.name}（${saved.path}）。`);
    } catch (error) { setKeyNotice(errorMessage(error)); }
    finally { setKeyBusy(false); }
  }

  async function importKeyFromFile() {
    if (keyBusy) return;
    setKeyBusy(true); setKeyNotice('');
    try {
      const imported = await desktop.choosePrivateKey();
      if (imported) {
        await loadKeys();
        setKeyNotice(`已导入私钥：${imported}`);
      }
    } catch (error) { setKeyNotice(errorMessage(error)); }
    finally { setKeyBusy(false); }
  }

  async function copyPublicKey(key: SSHKeyInfo) {
    if (!key.publicKey) { setKeyNotice(`密钥 ${key.name} 缺少公钥信息`); return; }
    try {
      await desktop.clipboardSetText(key.publicKey);
      setKeyNotice(`已复制 ${key.name} 的公钥，请添加到服务器 ~/.ssh/authorized_keys。`);
    } catch (error) { setKeyNotice(errorMessage(error)); }
  }

  async function removeKey(name: string) {
    if (keyBusy) return;
    setKeyBusy(true); setKeyNotice('');
    try {
      await desktop.deleteSSHKey(name);
      await loadKeys();
      setKeyNotice(`已删除本机密钥 ${name}`);
    } catch (error) { setKeyNotice(errorMessage(error)); }
    finally { setKeyBusy(false); }
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

  async function open(name: string, create = false) {
    if (terminals.some((terminal) => terminal.name === name && terminal.connectionId === selected)) {
      const existing = terminals.find(terminal => terminal.name === name && terminal.connectionId === selected)!;
      setActiveId(existing.key);
      if (detached.has(existing.key)) void detach(existing);
      return;
    }
    const openingKey = JSON.stringify([selected, name]);
    if (opening.current.has(openingKey)) return;
    opening.current.add(openingKey);
    setBusy(true); setMessage(`正在进入 ${name}…`);
    try {
      let workingDirectory = create ? cwd.trim() : '';
      if (create && !server?.input.local && homeDirectory) {
        workingDirectory = sessionDirectory(workingDirectory, homeDirectory.path);
      } else if (server?.input.local && workingDirectory === '~') workingDirectory = '';
      const grid = estimateGrid();
      const result = await desktop.openSession({ connectionId: selected!, name, cwd: workingDirectory, cols: grid?.cols, rows: grid?.rows });
      const item = { key: crypto.randomUUID(), connectionId: selected!, cwd: workingDirectory, id: result.terminalId, name: result.sessionName, backend: result.backend, cols: grid?.cols, rows: grid?.rows };
      setTerminals((current) => [...current, item]); setActiveId(item.key); setMessage('');
      window.setTimeout(() => void refresh(), 500);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { opening.current.delete(openingKey); setBusy(false); }
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
    if (selected) await removeServer(selected); setSessions([]); setMessage(server?.input.local ? (connected?.backend === 'local' ? '已断开本机，本地控制台已结束。' : '已断开本机，tmux / screen 会话继续运行。') : '已断开；持久会话仍在服务器运行。');
  }

  const login = <main className={`login-shell ${servers.length ? 'connection-overlay' : ''}`}>
    {servers.length > 0 && <button className="close-connections" onClick={() => setShowConnections(false)}>返回工作区</button>}
    <section className="brand-panel"><div className="brand-mark"><img src="./appicon.png" alt="" /></div><h1>Nohop Codex</h1><p>关掉电脑，任务继续跑。回来后点击原来的会话，立即接着工作。</p><div className="feature"><SquareTerminal size={18} /><span>Linux：tmux / screen</span></div><div className="feature"><Server size={18} /><span>Windows：原生 ConPTY</span></div></section>
    <section className="connect-card"><button className="host-card local-connection" disabled={busy} onClick={() => void connectLocal()}><SquareTerminal size={21} /><span><strong>连接到本机</strong><small>直接管理本机终端与会话，无需 SSH</small></span><ChevronRight size={17} /></button><div className="connect-title"><div><h2>Remote SSH</h2><small>选择 ~/.ssh/config 中的主机</small></div><div className="connect-actions">{isAndroid && <button type="button" className="key-store-button" title="管理应用本机保存的 SSH 密钥" onClick={() => void openKeyManager()}><KeyRound size={15} /><span>密钥{sshKeys.length > 0 ? ` (${sshKeys.length})` : ''}</span></button>}<button className="icon" title="编辑 SSH config" onClick={() => void editConfig()}><FilePenLine size={18} /></button></div></div><button className="primary add-host-button" disabled={busy} onClick={() => { setAddError(''); setAddHostKeyPath(''); setShowAddHost(true); }}><Plus size={17} />添加 SSH 主机</button><div className="host-list">{hosts.map((item) => <button className="host-card" key={item.alias} disabled={busy} onClick={() => void connectHost(item.alias)}><Server size={18} /><span><strong>{item.alias}</strong><small>{item.user ? `${item.user}@` : ''}{item.host}:{item.port}</small></span><ChevronRight size={17} /></button>)}{hosts.length === 0 && <div className="hosts-empty">SSH config 中还没有主机<br/><button disabled={busy} onClick={() => { setAddError(''); setAddHostKeyPath(''); setShowAddHost(true); }}>输入 SSH 命令添加</button></div>}</div><button className="manual-toggle" onClick={() => setShowManual((value) => !value)}>{showManual ? '收起手动连接' : '手动连接…'}</button>{showManual && <form className="manual-form" onSubmit={connect}><label>主机<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="server.example.com" required /></label><div className="row"><label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="port">端口<input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label></div><label>认证方式<select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}>{isAndroid && <option value="auto">自动（本机密钥 / 密码）</option>}<option value="password">密码</option><option value="privateKey">私钥</option><option value="agent">SSH Agent</option></select></label>{authMethod === 'password' && <label>密码（留空则连接时弹窗）<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}{authMethod === 'privateKey' && <>{isAndroid && sshKeys.length > 0 && <label>选用本机保存的密钥<select value={sshKeys.some(k => k.path === privateKeyPath) ? privateKeyPath : ''} onChange={(e) => { if (e.target.value) setPrivateKeyPath(e.target.value); }}><option value="">手动输入或从文件选择…</option>{sshKeys.map(k => <option key={k.name} value={k.path}>{k.name}{k.algorithm ? ` (${k.algorithm})` : ''}</option>)}</select></label>}<label>私钥<div className="file-field"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} placeholder={isAndroid ? '~/.ssh/id_ed25519' : ''} /><button type="button" onClick={async () => { const value = await desktop.choosePrivateKey(); if (value) { setPrivateKeyPath(value); if (isAndroid) void loadKeys(); } }}><KeyRound size={16} /></button></div></label><label>私钥口令（可选）<input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /></label></>}<button className="primary" disabled={busy}>{busy ? '连接中…' : '连接'}</button></form>}{message && <p className="message">{message}</p>}</section>
    {showAddHost && <div className="modal-backdrop"><form className="credential-modal add-host-modal" onSubmit={addHost}>
      <h3>添加 SSH 主机</h3>
      <p>输入平时使用的 SSH 命令，保存后立即连接。支持密码、私钥和 SSH Agent；需要密码或口令时会弹窗。</p>
      <label>SSH 命令<input autoFocus required disabled={busy} value={sshCommand} onChange={(event) => setSSHCommand(event.target.value)} placeholder="ssh ubuntu@example.com -p 22" /></label>
      <small>指定密钥：ssh -i ~/.ssh/id_ed25519 ubuntu@example.com<br />支持 -p、-l、-i、-J；含空格的路径请加引号。</small>
      {isAndroid && sshKeys.length > 0 && <label>使用本机密钥（可选）<select disabled={busy} value={addHostKeyPath} onChange={(event) => setAddHostKeyPath(event.target.value)}><option value="">自动尝试默认密钥 / 密码</option>{sshKeys.map(k => <option key={k.name} value={k.path}>{k.name}{k.isDefault ? '（默认）' : ''}{k.algorithm ? ` · ${k.algorithm}` : ''}</option>)}</select></label>}
      <label>主机别名<input required disabled={busy} value={sshAlias} onChange={(event) => setSSHAlias(event.target.value)} placeholder="例如：工作服务器" /></label>
      <small>保存到 ~/.ssh/config，以后可从主机列表直接连接。</small>
      {addError && <p className="message" role="alert">{addError}</p>}
      <div><button type="button" disabled={busy} onClick={() => setShowAddHost(false)}>取消</button><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存并连接'}</button></div>
    </form></div>}
    {isAndroid && showKeyManager && <div className="modal-backdrop"><section className="credential-modal key-manager-modal" aria-label="本机 SSH 密钥管理">
      <div className="key-manager-header">
        <div><h3>本机 SSH 密钥</h3><small>密钥保存在应用私有目录，安卓无需手写 ~/.ssh 文件即可连接。</small></div>
        <button type="button" onClick={() => setShowKeyManager(false)}>关闭</button>
      </div>
      {keyNotice && <p className="message" role="status">{keyNotice}</p>}
      <div className="key-list">
        {sshKeys.map(key => <div className="key-item" key={key.name}>
          <div className="key-item-top">
            <div>
              <strong>{key.name}</strong>
              <span className="key-meta">{key.algorithm || 'KEY'}{key.isDefault ? ' · 默认自动连接' : ''}{key.encrypted ? ' · 已设口令' : ''}</span>
            </div>
            <div className="key-item-actions">
              {key.publicKey && <button type="button" disabled={keyBusy} onClick={() => void copyPublicKey(key)}><Copy size={14} />复制公钥</button>}
              <button type="button" className="danger" disabled={keyBusy} onClick={() => void removeKey(key.name)}><Trash2 size={14} /></button>
            </div>
          </div>
          {key.fingerprint && <small className="key-fingerprint">{key.fingerprint}</small>}
          {key.publicKey && <input className="key-public-preview" readOnly value={key.publicKey} aria-label={`${key.name} 公钥`} onFocus={(e) => e.currentTarget.select()} />}
        </div>)}
        {sshKeys.length === 0 && <p className="empty">还没有保存的本机密钥，可在下方一键生成或粘贴导入。</p>}
      </div>
      <form className="key-section" onSubmit={generateKey}>
        <h4>一键生成 Ed25519 密钥</h4>
        <div className="key-form-row">
          <label>密钥名称<input required disabled={keyBusy} value={genKeyName} onChange={(e) => setGenKeyName(e.target.value)} placeholder="id_ed25519" /></label>
          <label>口令（可选）<input type="password" disabled={keyBusy} value={genKeyPassphrase} onChange={(e) => setGenKeyPassphrase(e.target.value)} placeholder="留空则免口令" /></label>
        </div>
        <button className="primary" disabled={keyBusy}>{keyBusy ? '处理中…' : '生成并保存密钥'}</button>
      </form>
      <form className="key-section" onSubmit={importKey}>
        <div className="key-import-title">
          <h4>粘贴或导入现有私钥</h4>
          <button type="button" disabled={keyBusy} onClick={() => void importKeyFromFile()}>从文件导入…</button>
        </div>
        <div className="key-form-row">
          <label>保存名称<input required disabled={keyBusy} value={importKeyName} onChange={(e) => setImportKeyName(e.target.value)} placeholder="例如：id_ed25519 或 work_key" /></label>
          <label>口令（如有加密可填，用于校验）<input type="password" disabled={keyBusy} value={importKeyPassphrase} onChange={(e) => setImportKeyPassphrase(e.target.value)} placeholder="可选" /></label>
        </div>
        <label>私钥内容<textarea rows={4} required disabled={keyBusy} value={importKeyContent} onChange={(e) => setImportKeyContent(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" /></label>
        <button type="submit" disabled={keyBusy}>保存粘贴的私钥</button>
      </form>
    </section></div>}
    {configText !== null && <div className="modal-backdrop"><section className="config-modal"><header><div><h2>SSH config</h2><small>~/.ssh/config</small></div><button className="icon" onClick={() => setConfigText(null)}><X size={18}/></button></header><textarea value={configText} onChange={(event) => setConfigText(event.target.value)} spellCheck={false} placeholder={'Host my-server\n  HostName 192.168.1.10\n  User ubuntu\n  IdentityFile ~/.ssh/id_ed25519'} /><footer><button onClick={() => setConfigText(null)}>取消</button><button className="primary" onClick={() => void saveConfig()}>保存配置</button></footer></section></div>}

  </main>;

  const workspace = <main style={{ '--terminal-shade': wallpaperShade / 100 } as React.CSSProperties} className={`workspace ${sidebarOpen ? 'sidebar-open' : ''}`}><button className="sidebar-shade" aria-label="关闭服务器列表" onClick={() => setSidebarOpen(false)} /><aside><div className="server-list"><button className="primary" onClick={() => setShowConnections(true)}><Plus size={16}/>连接其他服务器</button>{servers.map(s => <div className={`server-row ${selected === s.input.connectionId ? 'selected' : ''}`} key={s.input.connectionId}><button onClick={() => setSelected(s.input.connectionId)}><strong>{s.input.alias || s.input.host}</strong><small>{s.status}</small></button>{s.status !== '已连接' && <button title="重试连接" onClick={() => recover(s.input)}><RefreshCw size={14}/></button>}</div>)}</div><header><div><span className="eyebrow">{server?.status}</span><strong>{server?.input.alias || server?.input.host}</strong><small>{connected?.platform ?? '恢复连接中'} · {connected?.backend ?? ''}</small></div><button className="icon" title="断开连接" onClick={() => void disconnect()}><LogOut size={18} /></button></header><section className="new-session"><label>会话名称<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label><label onFocusCapture={ensureHomeDirectory}>工作目录{server?.input.local ? <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="~" /> : <RemotePathInput key={selected} connectionId={selected ?? ''} directory={homeDirectory} home={homeDirectory?.path} value={cwd} onChange={setCwd} directoriesOnly label="工作目录" placeholder="~" disabled={!connected} />}</label>{connected?.backend === 'none' && <p className="backend-warning">{server?.input.local ? '本机' : '远端'}未安装 tmux 或 screen，无法创建持久会话。请安装 tmux 后重新连接。</p>}<button className="primary" disabled={busy || (!connected || connected.backend === 'none')} title={!connected ? '正在恢复连接' : connected.backend === 'none' ? '远端需要安装 tmux 或 screen' : undefined} onClick={() => { setSidebarOpen(false); void open(newName, true); }}><Plus size={17} /> {!connected ? '等待恢复连接' : connected.backend === 'none' ? '需要安装 tmux / screen' : busy ? '正在进入…' : '新建并进入'}</button></section>{server?.input.local && connected?.backend === 'local' && <p className="local-session-note">本机控制台关闭标签后继续运行；断开本机连接或退出应用会结束会话。</p>}<div className="session-heading"><span>{server?.input.local ? '本机会话' : '远端会话'}</span><button className="icon" onClick={() => void refresh()}><RefreshCw size={16} /></button></div><div className="session-list">{sessions.map((session) => <div className="session-card" key={session.name} onClick={() => { setSidebarOpen(false); void open(session.name); }}><SquareTerminal size={18} /><div><strong>{session.name}</strong><small>{session.attached ? '已连接' : '等待重新进入'}{session.windows ? ` · ${session.windows} 窗口` : ''}</small></div><button className="delete" title="终止远端会话和其中的进程" onClick={(event) => { event.stopPropagation(); void kill(session.name); }}><Trash2 size={15} /></button></div>)}{sessions.length === 0 && <p className="empty">还没有持久会话</p>}</div></aside><section className="terminal-area"><nav>{terminals.map((item) => <TerminalTab key={item.key} active={activeId === item.key} enabled={import.meta.env.MODE !== 'android' && !!item.id} onDetach={() => void detach(item)}><button className="tab-select" onClick={() => { setActiveId(item.key); setSelected(item.connectionId); if (detached.has(item.key)) void detach(item); }}><span>{servers.find(s => s.input.connectionId === item.connectionId)?.input.alias || servers.find(s => s.input.connectionId === item.connectionId)?.input.host} · {item.name}</span></button>{import.meta.env.MODE !== 'android' && <button className="tab-action" title="拖出为独立窗口" disabled={!item.id} onClick={() => void detach(item)}>↗</button>}<button className="tab-action terminate" title="终止远端会话和其中的进程" onClick={() => void kill(item.name, item.connectionId)}><Trash2 size={13}/></button><button className="tab-action" title="关闭标签（会话继续运行）" onClick={() => void closeTerminal(item.key)}><X size={14}/></button></TerminalTab>)}</nav><div className="layout-toolbar"><button className="mobile-menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}>服务器 / 会话</button><button disabled={!connected || server?.input.local} onClick={() => { if (selected && server) setFileServer({ id: selected, name: server.input.alias || server.input.host }); }}>SFTP 文件</button><button disabled={!connected || server?.input.local} onClick={() => { if (selected && server) setForwardServer({ id: selected, name: server.input.alias || server.input.host }); }}>端口转发</button><label className="wallpaper-control">背景遮罩<input aria-label="背景遮罩浓度" type="range" min="15" max="90" value={wallpaperShade} onChange={event => setWallpaperShade(Number(event.target.value))} /><output>{wallpaperShade}%</output></label><button type="button" aria-pressed={lowLatency} title="关闭透明、背景图与高斯模糊以获得最低绘制延迟" onClick={() => setLowLatency(v => !v)}>极速纯色</button><span>终端布局</span>{([['single', '单屏'], ['columns', '左右分屏'], ['rows', '上下分屏'], ['grid', '网格']] as const).map(([value, label]) => <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>{label}</button>)}</div><div ref={stackRef} className={`terminal-stack layout-${layout}`}>{terminals.map((item) => <div key={item.key} className={`terminal-pane ${(layout !== 'single' || activeId === item.key || (!terminals.some(t => t.key === activeId) && item.key === terminals[0]?.key)) ? 'visible' : ''} ${activeId === item.key ? 'focused' : ''}`}><div className="pane-title">{servers.find(s => s.input.connectionId === item.connectionId)?.input.alias || servers.find(s => s.input.connectionId === item.connectionId)?.input.host} · {item.name}</div>{detached.has(item.key) ? <div className="terminal-empty"><h2>{item.name}</h2><p>已在独立窗口中打开</p><button onClick={() => void detach(item)}>显示窗口</button></div> : item.id ? <TerminalView item={item} focused={activeId === item.key} active={layout !== 'single' || activeId === item.key || (!terminals.some(t => t.key === activeId) && item.key === terminals[0]?.key)} lowLatency={lowLatency} onFocus={() => { setActiveId(item.key); setSelected(item.connectionId); }} /> : <div className="terminal-empty">等待恢复远端会话…</div>}</div>)}{terminals.length === 0 && <div className="terminal-empty"><SquareTerminal size={48} /><h2>选择一个会话</h2><p>点击左侧会话即可进入；关闭标签不会结束会话任务。使用垃圾桶可终止会话。</p></div>}</div><div className="status">{message || '截图粘贴：Ctrl+Shift+V / Shift+Insert / 右键粘贴 · 图片上传到当前服务器后插入路径'} </div></section></main>;
  return <>{forwardServer && <PortForwards key={forwardServer.id} connectionId={forwardServer.id} serverName={forwardServer.name} onBack={() => setForwardServer(null)} />}{fileServer && <FileBrowser key={fileServer.id} connectionId={fileServer.id} serverName={fileServer.name} onBack={() => setFileServer(null)} />}<div style={{ display: fileServer || forwardServer ? 'none' : 'contents' }}>{servers.length > 0 && workspace}{(servers.length === 0 || showConnections) && login}</div>    {credential && <div className="modal-backdrop credential-layer"><form className="credential-modal" onSubmit={(event) => { event.preventDefault(); answerCredential(false); }}><KeyRound size={24}/><h3>{credential.kind === 'hostkey' ? '首次连接服务器' : credential.kind === 'passphrase' ? 'SSH 私钥口令' : 'SSH 认证'}</h3><p>{credential.prompt}</p>{credential.kind !== 'hostkey' && <input autoFocus type={credential.secret ? 'password' : 'text'} value={credentialValue} onChange={(event) => setCredentialValue(event.target.value)} />}<div><button type="button" onClick={() => answerCredential(true)}>取消</button><button className="primary">{credential.kind === 'hostkey' ? '信任并连接' : '确认'}</button></div></form></div>}
  </>;
}
