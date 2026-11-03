import { describe, expect, it, vi } from 'vitest';
import { bindTerminalLayout } from './terminal-layout';

function fixture() {
  let size: { cols: number; rows: number } | null = { cols: 100, rows: 30 };
  const resize = vi.fn<(cols: number, rows: number) => Promise<void>>().mockResolvedValue();
  const ready = vi.fn<() => Promise<void>>().mockResolvedValue();
  const refresh = vi.fn();
  const fail = vi.fn();
  const layout = bindTerminalLayout(() => size, resize, ready, refresh, fail);
  return { layout, resize, ready, refresh, fail, size: (next: typeof size) => { size = next; } };
}

describe('terminal layout synchronization', () => {
  it('waits for a visible size and remote resize before releasing output', async () => {
    const f = fixture();
    f.size(null); f.layout.fit();
    expect(f.ready).not.toHaveBeenCalled();
    let finish!: () => void;
    f.resize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.size({ cols: 100, rows: 30 }); f.layout.fit();
    expect(f.ready).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(f.ready).toHaveBeenCalledTimes(1));
    f.layout.fit();
    await Promise.resolve();
    expect(f.resize).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    f.layout.dispose();
  });

  it('serializes resizes and keeps the latest size during a drag', async () => {
    const f = fixture();
    let finish!: () => void;
    f.resize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.layout.fit();
    f.size({ cols: 110, rows: 31 }); f.layout.fit();
    f.size({ cols: 120, rows: 32 }); f.layout.fit();
    expect(f.resize).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(f.resize).toHaveBeenCalledTimes(2));
    expect(f.resize).toHaveBeenLastCalledWith(120, 32);
    expect(f.ready).toHaveBeenCalledTimes(1);
    f.layout.dispose();
  });

  it('does not start a disposed terminal after a pending resize', async () => {
    const f = fixture();
    let finish!: () => void;
    f.resize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.layout.fit(); f.layout.dispose(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it('reports failed resizes and retries on the next layout update', async () => {
    const f = fixture();
    f.resize.mockRejectedValueOnce(new Error('offline'));
    f.layout.fit();
    await vi.waitFor(() => expect(f.fail).toHaveBeenCalledTimes(1));
    expect(f.ready).not.toHaveBeenCalled();
    f.layout.fit();
    await vi.waitFor(() => expect(f.ready).toHaveBeenCalledTimes(1));
    f.layout.dispose();
  });
});
