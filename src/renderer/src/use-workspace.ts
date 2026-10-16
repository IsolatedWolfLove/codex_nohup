import { useEffect, useRef, useState } from 'react';
import { desktop } from './desktop-api';
import type { ConnectInput, ConnectionInfo } from '../../shared/contracts';
import { readWorkspace, reconnectDelay, safeConnection, workspaceKey, type Layout, type SavedTab } from './workspace';

export interface OpenTerminal extends SavedTab { id: string; backend: string }
export interface ServerConnection { input: ConnectInput; info: ConnectionInfo | null; status: string }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export function useWorkspace(report: (message: string) => void) {
  const [servers, setServers] = useState<ServerConnection[]>([]);
  const [terminals, setTerminals] = useState<OpenTerminal[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>('single');
  const [initialized, setInitialized] = useState(false);
  const state = useRef({ servers, terminals }); state.current = { servers, terminals };
  const jobs = useRef(new Map<string, { cancelled: boolean; timer?: ReturnType<typeof setTimeout> }>());
  const mounted = useRef(false);

  function recover(input: ConnectInput) {
    const id = input.connectionId;
    if (jobs.current.has(id)) return;
    const job = { cancelled: false } as { cancelled: boolean; timer?: ReturnType<typeof setTimeout> };
    jobs.current.set(id, job);
    let attempt = 0;
    const previousTabs = state.current.terminals.filter(t => t.connectionId === id);
    const tabOrder = state.current.terminals.map(t => t.key);
    setServers(current => current.map(s => s.input.connectionId === id ? { ...s, info: null } : s));
    const run = async () => {
      const reopened: OpenTerminal[] = [];
      if (job.cancelled) return;
      setServers(current => current.map(s => s.input.connectionId === id ? { ...s, status: attempt ? `重连中（第 ${attempt + 1} 次）` : '正在恢复…' } : s));
      try {
        const info = await desktop.connect(input);
        if (job.cancelled) return;
        const sessions = await desktop.listSessions(id);
        const tabs = state.current.terminals.filter(t => t.connectionId === id);
        for (const tab of tabs) {
          if (job.cancelled) return;
          // A session ended remotely must not be recreated by recovery.
          const session = sessions.find(s => s.name === tab.name) ?? sessions.find(s => s.backend === 'screen' && s.name.endsWith('.' + tab.name));
          if (!session) continue;
          const opened = await desktop.openSession({ connectionId: id, name: session.name });
          if (job.cancelled) { void desktop.closeTerminal(opened.terminalId); return; }
          reopened.push({ ...tab, name: opened.sessionName, id: opened.terminalId, backend: opened.backend });
        }
        if (job.cancelled) return;
        setTerminals(current => {
          const liveKeys = new Set(current.map(t => t.key));
          const surviving = reopened.filter(t => liveKeys.has(t.key));
          reopened.filter(t => !liveKeys.has(t.key)).forEach(t => void desktop.closeTerminal(t.id));
          return [...current.filter(t => t.connectionId !== id), ...surviving].sort((a, b) => tabOrder.indexOf(a.key) - tabOrder.indexOf(b.key));
        });
        previousTabs.filter(t => t.id).forEach(t => void desktop.closeTerminal(t.id));
        setServers(current => current.map(s => s.input.connectionId === id ? { input, info, status: '已连接' } : s));
        jobs.current.delete(id);
      } catch (error) {
        reopened.forEach(t => void desktop.closeTerminal(t.id));
        if (job.cancelled) return;
        report(`${input.alias || input.host}：${errorText(error)}`);
        if (/取消|cancel|host key|known_hosts|主机密钥|密钥.*变化/i.test(errorText(error))) {
          setServers(current => current.map(s => s.input.connectionId === id ? { ...s, status: '恢复已暂停，请手动重试' } : s));
          jobs.current.delete(id); return;
        }
        const delay = reconnectDelay(attempt++);
        setServers(current => current.map(s => s.input.connectionId === id ? { ...s, status: `${delay / 1000} 秒后重连` } : s));
        job.timer = setTimeout(() => void run(), delay);
      }
    };
    void run();
  }

  useEffect(() => {
    mounted.current = true;
    let saved = null;
    try { saved = readWorkspace(localStorage.getItem(workspaceKey)); } catch { /* Storage can be disabled. */ }
    if (saved) {
      const restoredServers = saved.servers.map(input => ({ input, info: null, status: '等待恢复…' }));
      const restoredTabs = saved.tabs.map(tab => ({ ...tab, id: '', backend: 'none' }));
      state.current = { servers: restoredServers, terminals: restoredTabs };
      setServers(restoredServers); setTerminals(restoredTabs);
      setSelected(saved.selected); setActiveId(saved.active); setLayout(saved.layout);
      // Defer until credential listeners are installed, including StrictMode's second mount.
      const snapshot = saved;
      queueMicrotask(() => { if (mounted.current) snapshot.servers.forEach(input => recover(input)); });
    }
    setInitialized(true);
    const off = desktop.onTerminalEvent(event => {
      if (event.type !== 'disconnected') return;
      const server = state.current.servers.find(s => s.input.connectionId === event.connectionId);
      if (server) recover(server.input);
    });
    return () => {
      mounted.current = false; off();
      jobs.current.forEach(job => { job.cancelled = true; clearTimeout(job.timer); }); jobs.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    try { localStorage.setItem(workspaceKey, JSON.stringify({ servers: servers.map(s => safeConnection(s.input)),
      tabs: terminals.map(({ key, connectionId, name, cwd }) => ({ key, connectionId, name, cwd })), selected, active: activeId, layout })); }
    catch { report('工作区保存失败：本地存储不可用。'); }
  }, [servers, terminals, selected, activeId, layout, initialized]);

  async function addServer(input: ConnectInput) {
    const info = await desktop.connect(input);
    if (!mounted.current) return;
    setServers(current => [...current, { input: safeConnection(input), info, status: '已连接' }]);
    setSelected(input.connectionId);
    return info;
  }
  async function removeServer(id: string) {
    const job = jobs.current.get(id); if (job) { job.cancelled = true; clearTimeout(job.timer); jobs.current.delete(id); }
    setServers(current => current.filter(s => s.input.connectionId !== id));
    setTerminals(current => current.filter(t => t.connectionId !== id));
    setSelected(current => current === id ? state.current.servers.find(s => s.input.connectionId !== id)?.input.connectionId ?? null : current);
    await desktop.disconnect(id);
  }
  return { servers, terminals, setTerminals, selected, setSelected, activeId, setActiveId, layout, setLayout, addServer, removeServer, recover };
}
