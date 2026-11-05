import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultShortcuts, readShortcuts, shortcutData, shortcutStorageKey } from './mobile-shortcuts';

afterEach(() => vi.unstubAllGlobals());
describe('mobile shortcuts', () => {
  const shortcut = defaultShortcuts[0];
  it('encodes control characters and modified navigation keys', () => {
    expect(shortcutData({ ...shortcut, key: 'c', ctrl: true })).toBe('\x03');
    expect(shortcutData({ ...shortcut, key: ' ', ctrl: true })).toBe('\x00');
    expect(shortcutData({ ...shortcut, key: 'x', alt: true })).toBe('\x1bx');
    expect(shortcutData({ ...shortcut, key: '↑', ctrl: true, shift: true })).toBe('\x1b[1;6A');
    expect(shortcutData({ ...shortcut, key: 'Delete', ctrl: true })).toBe('\x1b[3;5~');
    expect(shortcutData({ ...shortcut, key: 'Tab', shift: true })).toBe('\x1b[Z');
    expect(() => shortcutData({ ...shortcut, key: 'command' })).toThrow('一个字符');
  });
  it('does not submit saved text unless Enter is explicitly enabled', () => {
    expect(shortcutData({ ...shortcut, kind: 'text', text: 'codex resume', enter: false })).toBe('codex resume');
    expect(shortcutData({ ...shortcut, kind: 'text', text: 'codex resume', enter: true })).toBe('codex resume\r');
  });
  it('restores ordered custom keys and an intentionally empty toolbar, rejecting corrupted settings', () => {
    const getItem = vi.fn().mockReturnValue(JSON.stringify([defaultShortcuts[2], defaultShortcuts[0]]));
    vi.stubGlobal('localStorage', { getItem });
    expect(readShortcuts().map(key => key.label)).toEqual(['Ctrl+C', 'Esc']);
    expect(getItem).toHaveBeenCalledWith(shortcutStorageKey);
    getItem.mockReturnValue('[]'); expect(readShortcuts()).toEqual([]);
    getItem.mockReturnValue(JSON.stringify([{ ...shortcut, key: 'not a key' }])); expect(readShortcuts()).toEqual(defaultShortcuts);
    getItem.mockReturnValue('{broken'); expect(readShortcuts()).toEqual(defaultShortcuts);
  });
});
