import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { bindTerminalScrolling } from './terminal-scrolling';

afterEach(() => { vi.unstubAllGlobals(); });

function fixture(type = 'normal', backend = 'conpty') {
  vi.stubGlobal('window', globalThis);
  const surface = Object.assign(new EventTarget(), { clientHeight: 240, querySelector: () => ({ getBoundingClientRect: () => ({ height: 240 }) }) });
  const instance = { rows: 24, buffer: { active: { type, baseY: 100, viewportY: 100 } },
    scrollLines: vi.fn(), scrollToLine: vi.fn(), onScroll: () => ({ dispose() {} }),
    onWriteParsed: () => ({ dispose() {} }), onResize: () => ({ dispose() {} }) };
  const api = {
    getTerminalScrollState: vi.fn().mockResolvedValue({ lines: 100, position: 100, rows: 24 }),
    scrollTerminal: vi.fn().mockResolvedValue({ lines: 100, position: 90, rows: 24 }),
  };
  const fail = vi.fn();
  const scroller = bindTerminalScrolling(instance as unknown as Terminal, surface as unknown as HTMLElement, backend, 'id', api, vi.fn(), fail, () => true);
  const wheel = (deltaY: number, deltaMode = 0) => {
    const event = Object.assign(new Event('wheel', { cancelable: true }), { deltaY, deltaMode });
    surface.dispatchEvent(event); return event;
  };
  return { scroller, instance, api, wheel, fail };
}

describe('terminal scrolling', () => {
  it('scrolls local history and accumulates touchpad fractions', () => {
    const f = fixture();
    try {
      expect(f.wheel(-4).defaultPrevented).toBe(true);
      f.wheel(-4); f.wheel(-4);
      expect(f.instance.scrollLines).toHaveBeenCalledExactlyOnceWith(-1);
      f.scroller.setPosition(30);
      expect(f.instance.scrollToLine).toHaveBeenCalledWith(30);
      expect(f.api.scrollTerminal).not.toHaveBeenCalled();
    } finally { f.scroller.dispose(); }
  });
  it('routes tmux alternate-screen wheels and scrollbar positions to history', async () => {
    const f = fixture('alternate', 'tmux');
    try {
      await Promise.resolve();
      f.wheel(-3, 1);
      await vi.waitFor(() => expect(f.api.scrollTerminal).toHaveBeenCalledWith('id', -3, true));
      f.scroller.setPosition(15);
      await vi.waitFor(() => expect(f.api.scrollTerminal).toHaveBeenCalledWith('id', 15, false));
      expect(f.instance.scrollLines).not.toHaveBeenCalled();
    } finally { f.scroller.dispose(); }
  });
  it('coalesces wheel requests while an earlier scroll is pending', async () => {
    const f = fixture('alternate', 'tmux');
    try {
      await Promise.resolve();
      let resolve!: (state: {lines:number; position:number; rows:number}) => void;
      f.api.scrollTerminal.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      f.wheel(-1, 1); f.wheel(-2, 1); f.wheel(-3, 1);
      expect(f.api.scrollTerminal).toHaveBeenCalledTimes(1);
      resolve({lines:100,position:99,rows:24});
      await vi.waitFor(() => expect(f.api.scrollTerminal).toHaveBeenLastCalledWith('id', -5, true));
    } finally { f.scroller.dispose(); }
  });
});
