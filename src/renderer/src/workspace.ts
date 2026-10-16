import type { ConnectInput } from '../../shared/contracts';

export type Layout = 'single' | 'columns' | 'rows' | 'grid';
export interface SavedTab { key: string; connectionId: string; name: string; cwd: string }
export interface SavedWorkspace {
  servers: ConnectInput[];
  tabs: SavedTab[];
  selected: string | null;
  active: string | null;
  layout: Layout;
}
export const workspaceKey = 'nohop.workspace.v1';

// Explicit allowlist: passwords and passphrases must never reach localStorage.
export function safeConnection(input: ConnectInput): ConnectInput {
  return { connectionId: input.connectionId, alias: input.alias, host: input.host,
    port: input.port, username: input.username, authMethod: input.authMethod,
    privateKeyPath: input.privateKeyPath, proxyJumpHost: input.proxyJumpHost,
    proxyJumpPort: input.proxyJumpPort, proxyJumpUser: input.proxyJumpUser, proxyJumpKey: input.proxyJumpKey };
}
export function readWorkspace(raw: string | null): SavedWorkspace | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || !Array.isArray(value.servers) || !Array.isArray(value.tabs)) return null;
    const servers = value.servers.filter((s: ConnectInput) => s && typeof s.connectionId === 'string' && /^[\w-]+$/.test(s.connectionId) && typeof s.host === 'string' && typeof s.username === 'string' && Number.isInteger(s.port) && s.port > 0 && s.port < 65536 && ['auto', 'password', 'privateKey', 'agent'].includes(s.authMethod)).map(safeConnection);
    const ids = new Set(servers.map((s: ConnectInput) => s.connectionId));
    const tabs = value.tabs.filter((t: SavedTab) => t && typeof t.key === 'string' && ids.has(t.connectionId) && typeof t.name === 'string' && typeof t.cwd === 'string');
    return { servers, tabs, selected: ids.has(value.selected) ? value.selected : servers[0]?.connectionId ?? null,
      active: tabs.some((t: SavedTab) => t.key === value.active) ? value.active : tabs[0]?.key ?? null,
      layout: ['single', 'columns', 'rows', 'grid'].includes(value.layout) ? value.layout : 'single' };
  } catch { return null; }
}
export const reconnectDelay = (attempt: number) => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
