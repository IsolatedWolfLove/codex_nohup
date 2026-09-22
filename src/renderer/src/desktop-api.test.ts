import { describe, expect, it, vi } from 'vitest';
import { desktop, decodeTerminalData } from './desktop-api';

describe('Wails terminal bridge', () => {
  it('preserves UTF-8 split across SSH packets', () => {
    const encoded = new TextEncoder().encode('终端🙂');
    const split = 2;
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const decoder = new TextDecoder();
    const first = decoder.decode(decodeTerminalData(b64(encoded.slice(0, split))), { stream: true });
    expect(first + decoder.decode(decodeTerminalData(b64(encoded.slice(split))))).toBe('终端🙂');
  });
  it('forwards native calls and returns the event unsubscribe function', async () => {
    const ready = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = vi.fn();
    const on = vi.fn().mockReturnValue(unsubscribe);
    vi.stubGlobal('window', { go: { main: { App: { ReadyTerminal: ready } } }, runtime: { EventsOn: on } });
    try {
      const callback = vi.fn();
      expect(desktop.onTerminalEvent(callback)).toBe(unsubscribe);
      expect(on).toHaveBeenCalledWith('terminal:event', callback);
      await desktop.readyTerminal('test');
      expect(ready).toHaveBeenCalledWith('test');
    } finally { vi.unstubAllGlobals(); }
  });
});
