import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTerminalRendering } from './terminal-rendering';

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let parsed = () => {};
  let visible = true;
  const unsubscribe = vi.fn();
  const terminal = {
    rows: 24,
    refresh: vi.fn(),
    onWriteParsed: (callback: () => void) => { parsed = callback; return { dispose: unsubscribe }; },
  };
  const rendering = bindTerminalRendering(terminal, () => visible);
  return {
    terminal, rendering, frames, unsubscribe,
    output: () => parsed(),
    visible: (value: boolean) => { visible = value; },
    paint() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('terminal output repaint', () => {
  it('coalesces parsed TUI updates into one repaint using the latest row count', () => {
    const f = fixture();
    f.output(); f.output(); f.output();
    expect(f.terminal.refresh).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(1);
    f.terminal.rows = 40;
    f.paint();
    expect(f.terminal.refresh).toHaveBeenCalledExactlyOnceWith(0, 39);
    f.output(); f.paint();
    expect(f.terminal.refresh).toHaveBeenCalledTimes(2);
    f.rendering.dispose();
  });

  it('skips hidden terminals and repaints when their layout is restored', () => {
    const f = fixture();
    f.output(); f.visible(false); f.paint();
    f.output();
    expect(f.frames.size).toBe(0);
    expect(f.terminal.refresh).not.toHaveBeenCalled();
    f.visible(true); f.rendering.refresh(); f.paint();
    expect(f.terminal.refresh).toHaveBeenCalledExactlyOnceWith(0, 23);
    f.rendering.dispose();
  });

  it('cancels pending repaint and ignores late output after disposal', () => {
    const f = fixture();
    f.output(); f.rendering.dispose();
    expect(f.frames.size).toBe(0);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.output(); f.rendering.refresh(); f.paint();
    expect(f.terminal.refresh).not.toHaveBeenCalled();
  });
});
