// Keep remote PTY changes ordered and coalesce intermediate drag sizes.
export function bindTerminalLayout(
  measure: () => { cols: number; rows: number } | null,
  resize: (cols: number, rows: number) => Promise<void>,
  ready: () => Promise<void>,
  refresh: () => void,
  fail: (error: unknown) => void,
  initialSynced = '',
) {
  let disposed = false;
  let running = false;
  let pending: { cols: number; rows: number } | null = null;
  let synced = initialSynced;
  let started = false;
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const size = pending;
        pending = null;
        const key = `${size.cols}:${size.rows}`;
        if (key !== synced) {
          await resize(size.cols, size.rows);
          if (disposed) return;
          synced = key;
        }
        if (!started) {
          await ready();
          if (disposed) return;
          started = true;
        }
      }
    } catch (error) {
      if (!disposed) fail(error);
    } finally { running = false; }
  };
  return {
    fit() {
      if (disposed) return;
      const size = measure();
      if (!size) return;
      refresh();
      pending = size;
      void pump();
    },
    dispose() { disposed = true; pending = null; },
  };
}
