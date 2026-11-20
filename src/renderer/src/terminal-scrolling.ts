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
  let remoteDirty = false;
  let pendingLines = 0;
  let pendingPosition: number | null = null;
  let remainder = 0;
  let lastRemote: TerminalScrollState = { lines: 0, position: 0, rows: instance.rows };
  const remote = () => backend === 'tmux' && instance.buffer.active.type === 'alternate';
  // Read on each event: full-screen applications enable/disable this at runtime.
  const applicationMouse = () => ['vt200', 'drag', 'any'].includes(instance.modes.mouseTrackingMode);
  const applyRemote = (state: TerminalScrollState) => {
    lastRemote = state;
    update(state);
  };
  const optimisticRemote = (value: number, relative: boolean) => {
    if (lastRemote.lines <= 0) return;
    const next = Math.max(0, Math.min(lastRemote.lines, relative ? lastRemote.position + value : value));
    if (next !== lastRemote.position) {
      lastRemote = { ...lastRemote, position: next };
      update(lastRemote);
    }
  };
  const localState = () => {
    if (!disposed) {
      if (remote()) { remoteDirty = true; return; }
      update({ lines: instance.buffer.active.baseY, position: instance.buffer.active.viewportY, rows: instance.rows });
    }
  };
  const pump = async () => {
    if (running || polling || disposed) return;
    running = true;
    try {
      while (!disposed && (pendingPosition !== null || pendingLines !== 0)) {
        // A queued history gesture must not enter copy mode after a TUI takes over.
        if (applicationMouse()) pendingLines = 0;
        if (pendingPosition === null && pendingLines === 0) break;
        const relative = pendingPosition === null;
        const value = relative ? pendingLines : pendingPosition!;
        if (relative) pendingLines = 0; else pendingPosition = null;
        const state = await api.scrollTerminal(id, value, relative);
        if (!disposed) { remoteDirty = false; applyRemote(state); }
      }
    } catch (error) {
      pendingPosition = null; pendingLines = 0;
      if (!disposed) fail(error);
    } finally { running = false; }
  };
  const poll = async (force = false) => {
    if (disposed || !isActive() || running || polling) return;
    if (!remote()) { localState(); return; }
    if (!force && !remoteDirty) return;
    polling = true;
    remoteDirty = false;
    try {
      const state = await api.getTerminalScrollState(id);
      if (!disposed) applyRemote(state);
    } catch { /* A disconnected terminal stops exposing remote history. */ }
    finally { polling = false; void pump(); }
  };
  const wheel = (event: WheelEvent) => {
    if (applicationMouse()) {
      // Let xterm encode the wheel using the application's negotiated mouse protocol.
      // tmux's alternate buffer alone does not mean the user wants shell history.
      remainder = 0;
      pendingLines = 0;
      return;
    }
    // With no mouse reporting, own history scrolling and suppress xterm's arrow fallback.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.deltaY) return;
    const rowHeight = (surface.querySelector('.xterm-screen')?.getBoundingClientRect().height || surface.clientHeight) / instance.rows;
    const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * instance.rows : event.deltaY / Math.max(1, rowHeight);
    remainder += delta;
    const lines = Math.trunc(remainder);
    remainder -= lines;
    if (!lines) return;
    if (remote()) { pendingLines += lines; optimisticRemote(lines, true); void pump(); }
    else { instance.scrollLines(lines); localState(); }
  };
  let touchY: number | null = null;
  let touchRemainder = 0;
  const touchStart = (event: TouchEvent) => {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    touchRemainder = 0;
  };
  const touchMove = (event: TouchEvent) => {
    if (disposed || touchY === null || event.touches.length !== 1) return;
    const next = event.touches[0].clientY;
    touchRemainder += (touchY - next) / Math.max(1, surface.clientHeight / instance.rows);
    touchY = next;
    event.preventDefault();
    event.stopImmediatePropagation();
    const lines = Math.trunc(touchRemainder);
    touchRemainder -= lines;
    if (!lines) return;
    if (remote()) { pendingLines += lines; optimisticRemote(lines, true); void pump(); }
    else { instance.scrollLines(lines); localState(); }
  };
  const touchEnd = () => { touchY = null; };
  surface.addEventListener('touchstart', touchStart, { capture: true, passive: true });
  surface.addEventListener('touchmove', touchMove, { capture: true, passive: false });
  surface.addEventListener('touchend', touchEnd, true);
  surface.addEventListener('touchcancel', touchEnd, true);
  surface.addEventListener('wheel', wheel, { capture: true, passive: false });
  const scroll = instance.onScroll(localState);
  const parsed = instance.onWriteParsed(localState);
  const resize = instance.onResize(localState);
  const timer = window.setInterval(() => void poll(), 3000);
  localState(); void poll(true);
  return {
    setPosition(position: number) {
      if (remote()) { pendingPosition = position; pendingLines = 0; optimisticRemote(position, false); void pump(); }
      else { instance.scrollToLine(position); localState(); }
    },
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      surface.removeEventListener('wheel', wheel, true);
      surface.removeEventListener('touchstart', touchStart, { capture: true });
      surface.removeEventListener('touchmove', touchMove, { capture: true });
      surface.removeEventListener('touchend', touchEnd, { capture: true });
      surface.removeEventListener('touchcancel', touchEnd, { capture: true });
      scroll.dispose(); parsed.dispose(); resize.dispose();
    },
  };
}
