import type { Terminal } from '@xterm/xterm';
import type { DesktopApi } from '../../shared/desktop-api';
import type { TerminalScrollState } from '../../shared/contracts';

export function bindTerminalScrolling(
  instance: Terminal, surface: HTMLElement, backend: string, id: string,
  api: Pick<DesktopApi, 'getTerminalScrollState' | 'scrollTerminal'>,
  update: (state: TerminalScrollState) => void, fail: (error: unknown) => void,
  isActive: () => boolean,
) {
  let disposed = false;
  let running = false;
  let polling = false;
  let pendingLines = 0;
  let pendingPosition: number | null = null;
  let remainder = 0;
  const remote = () => backend === 'tmux' && instance.buffer.active.type === 'alternate';
  const localState = () => {
    if (!disposed && !remote()) update({ lines: instance.buffer.active.baseY, position: instance.buffer.active.viewportY, rows: instance.rows });
  };
  const pump = async () => {
    if (running || polling || disposed) return;
    running = true;
    try {
      while (!disposed && (pendingPosition !== null || pendingLines !== 0)) {
        const relative = pendingPosition === null;
        const value = relative ? pendingLines : pendingPosition!;
        if (relative) pendingLines = 0; else pendingPosition = null;
        const state = await api.scrollTerminal(id, value, relative);
        if (!disposed) update(state);
      }
    } catch (error) {
      pendingPosition = null; pendingLines = 0;
      if (!disposed) fail(error);
    } finally { running = false; }
  };
  const poll = async () => {
    if (disposed || !isActive() || running || polling) return;
    if (!remote()) { localState(); return; }
    polling = true;
    try {
      const state = await api.getTerminalScrollState(id);
      if (!disposed) update(state);
    } catch { /* A disconnected terminal stops exposing remote history. */ }
    finally { polling = false; void pump(); }
  };
  const wheel = (event: WheelEvent) => {
    // Capture before xterm's mouse-reporting and alternate-screen arrow fallback.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.deltaY) return;
    const rowHeight = (surface.querySelector('.xterm-screen')?.getBoundingClientRect().height || surface.clientHeight) / instance.rows;
    const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * instance.rows : event.deltaY / Math.max(1, rowHeight);
    remainder += delta;
    const lines = Math.trunc(remainder);
    remainder -= lines;
    if (!lines) return;
    if (remote()) { pendingLines += lines; void pump(); }
    else { instance.scrollLines(lines); localState(); }
  };
  surface.addEventListener('wheel', wheel, { capture: true, passive: false });
  const scroll = instance.onScroll(localState);
  const parsed = instance.onWriteParsed(localState);
  const resize = instance.onResize(localState);
  const timer = window.setInterval(() => void poll(), 1000);
  localState(); void poll();
  return {
    setPosition(position: number) {
      if (remote()) { pendingPosition = position; pendingLines = 0; void pump(); }
      else { instance.scrollToLine(position); localState(); }
    },
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      surface.removeEventListener('wheel', wheel, true);
      scroll.dispose(); parsed.dispose(); resize.dispose();
    },
  };
}
