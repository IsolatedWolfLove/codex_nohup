export interface MobileShortcut {
  id: string; label: string; kind: 'key' | 'text'; key: string; text: string;
  ctrl: boolean; alt: boolean; shift: boolean; enter: boolean;
}
export const shortcutStorageKey = 'nohop.mobile-shortcuts.v1';
export const shortcutKeys = ['Esc', 'Tab', 'Enter', 'Backspace', '↑', '↓', '←', '→', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'];
export const defaultShortcuts: MobileShortcut[] = ['Esc', 'Tab', 'Ctrl+C', 'Ctrl+D', 'Ctrl+Z', '↑', '↓', '←', '→'].map((label, index) => ({
  id: `default-${index}`, label, kind: 'key', key: label.startsWith('Ctrl+') ? label.slice(5) : label,
  text: '', ctrl: label.startsWith('Ctrl+'), alt: false, shift: false, enter: false,
}));

export function shortcutData(shortcut: MobileShortcut): string {
  if (shortcut.kind === 'text') return shortcut.text + (shortcut.enter ? '\r' : '');
  const { key, ctrl, alt, shift } = shortcut;
  const modifier = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  const arrow: Record<string, string> = { '↑': 'A', '↓': 'B', '→': 'C', '←': 'D', Home: 'H', End: 'F' };
  if (arrow[key]) return `\x1b[${modifier === 1 ? '' : `1;${modifier}`}${arrow[key]}`;
  const tilde: Record<string, number> = { PageUp: 5, PageDown: 6, Delete: 3 };
  if (tilde[key]) return `\x1b[${tilde[key]}${modifier === 1 ? '' : `;${modifier}`}~`;
  const special: Record<string, string> = { Esc: '\x1b', Tab: shift ? '\x1b[Z' : '\t', Enter: '\r', Backspace: '\x7f' };
  let data = special[key];
  if (data === undefined) {
    if (key.length !== 1) throw new Error('按键应为一个字符或列表中的特殊键');
    data = shift ? key.toUpperCase() : key;
    if (ctrl) {
      const code = key.toUpperCase().charCodeAt(0);
      if (key === '?') data = '\x7f';
      else if (key === ' ') data = '\x00';
      else if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
      else throw new Error('Ctrl 组合键支持字母、空格及 @ [ \\ ] ^ _ ?');
    }
  }
  return (alt ? '\x1b' : '') + data;
}

export function readShortcuts(): MobileShortcut[] {
  try {
    const raw = localStorage.getItem(shortcutStorageKey);
    if (raw === null) return defaultShortcuts;
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 40) return defaultShortcuts;
    const ids = new Set<string>();
    for (const value of values) {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || ids.has(value.id) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 16 ||
          (value.kind !== 'key' && value.kind !== 'text') || typeof value.key !== 'string' || typeof value.text !== 'string' || value.text.length > 4096 ||
          !['ctrl', 'alt', 'shift', 'enter'].every(key => typeof value[key] === 'boolean')) return defaultShortcuts;
      shortcutData(value); ids.add(value.id);
    }
    return values;
  } catch { return defaultShortcuts; }
}
