import type { Terminal } from '@xterm/xterm';

// A WebView can miss damage from cursor-only/erase updates used by TUI apps.
// Repaint after parsing, when the entire batch has reached xterm's buffer.
export function bindTerminalRendering(
  terminal: Pick<Terminal, 'onWriteParsed' | 'refresh' | 'rows'>,
  isVisible: () => boolean,
) {
  let frame: number | null = null;
  let disposed = false;
  const refresh = () => {
    if (disposed || frame !== null || !isVisible()) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!disposed && isVisible()) terminal.refresh(0, terminal.rows - 1);
    });
  };
  const parsed = terminal.onWriteParsed(refresh);
  return {
    refresh,
    dispose() {
      disposed = true;
      parsed.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
