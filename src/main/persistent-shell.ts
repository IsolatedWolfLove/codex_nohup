import type { PersistentSession, SessionBackend } from '../shared/contracts';

const SEP = '\u0001';

export function normalizeSessionName(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return cleaned || 'nohop';
}

export function quoteSh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function supportProbe(): string {
  return 'if command -v tmux >/dev/null 2>&1; then echo tmux; elif command -v screen >/dev/null 2>&1; then echo screen; else echo none; fi';
}

export function parseBackend(output: string): SessionBackend {
  const value = output.trim().split(/\s+/).pop();
  return value === 'tmux' || value === 'screen' ? value : 'none';
}

export function listCommand(backend: SessionBackend): string | null {
  if (backend === 'tmux') {
    return `tmux list-sessions -F ${quoteSh(['#{session_name}', '#{session_windows}', '#{session_attached}', '#{session_created}'].join(SEP))} 2>/dev/null || true`;
  }
  if (backend === 'screen') return 'screen -ls 2>/dev/null || true';
  return null;
}

export function parseSessions(backend: SessionBackend, output: string): PersistentSession[] {
  if (backend === 'tmux') {
    return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [name, windows, attached, createdAt] = line.split(SEP);
      if (!name) return [];
      return [{
        name,
        windows: Number(windows) || undefined,
        attached: Number(attached) > 0,
        createdAt: Number(createdAt) || undefined,
        backend,
      }];
    });
  }
  if (backend === 'screen') {
    return output.split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+\.\S+)/.exec(line);
      return match ? [{ name: match[1], attached: /\(attached\)/i.test(line), backend }] : [];
    });
  }
  return [];
}

export function attachCommand(backend: SessionBackend, name: string, cwd?: string): string {
  const safeName = normalizeSessionName(name);
  if (backend === 'tmux') {
    const directory = cwd?.trim() ? ` -c ${quoteSh(cwd.trim())}` : '';
    return `if tmux has-session -t ${quoteSh(safeName)} 2>/dev/null; then exec tmux -u attach-session -t ${quoteSh(safeName)}; else exec tmux -u new-session -s ${quoteSh(safeName)}${directory}; fi`;
  }
  if (backend === 'screen') {
    const directory = cwd?.trim() ? `cd ${quoteSh(cwd.trim())}; ` : '';
    return `${directory}exec screen -xRR -S ${quoteSh(safeName)}`;
  }
  throw new Error('远端未安装 tmux 或 screen');
}

export function killCommand(backend: SessionBackend, name: string): string {
  if (backend === 'tmux') return `tmux kill-session -t ${quoteSh(normalizeSessionName(name))}`;
  if (backend === 'screen') return `screen -S ${quoteSh(name)} -X quit`;
  throw new Error('当前后端不支持结束会话');
}
