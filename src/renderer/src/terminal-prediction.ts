// Predictions are display-only. This module never changes the byte stream or
// xterm's authoritative buffer, including when an echo cannot be matched.
export interface EchoCell { text: string; width: number }
export interface EchoScreen {
  cells: readonly EchoCell[];
  x: number;
  y: number;
  baseY: number;
  cols: number;
  buffer: 'normal' | 'alternate';
  editable: boolean;
}
interface PendingEdit { screen: EchoScreen; sentAt: number }
export interface EchoOverlay {
  cells: Array<EchoCell & { x: number }>;
  x: number;
  y: number;
}

export const predictionStorageKey = 'nohop.local-echo.v1';
export type PredictionMode = 'auto' | 'off';
export function readPredictionMode(storage?: Pick<Storage, 'getItem'>): PredictionMode {
  try { return (storage ?? localStorage).getItem(predictionStorageKey) === 'off' ? 'off' : 'auto'; }
  catch { return 'auto'; }
}

// A deliberately small subset of xterm's default Unicode 6 width rules. Do not
// guess widths for emoji, combining marks or ambiguous grapheme sequences.
export function predictableWidth(char: string): number | null {
  const point = char.codePointAt(0)!;
  if (point >= 0x20 && point <= 0x7e) return 1;
  if (point >= 0x302a && point <= 0x302f) return null;
  if ((point >= 0x3000 && point <= 0x303e) ||
      (point >= 0x3400 && point <= 0x4dbf) ||
      (point >= 0x4e00 && point <= 0x9fff) ||
      (point >= 0xff01 && point <= 0xff60) ||
      (point >= 0xffe0 && point <= 0xffe6)) return 2;
  return null;
}

const samePosition = (a: EchoScreen, b: EchoScreen) =>
  a.buffer === b.buffer && a.cols === b.cols && a.y === b.y && a.baseY === b.baseY;
const sameCell = (a: EchoCell, b: EchoCell) => a.text === b.text && a.width === b.width;
const sameScreen = (a: EchoScreen, b: EchoScreen) => samePosition(a, b) && a.x === b.x &&
  a.cells.length === b.cells.length && a.cells.every((cell, i) => sameCell(cell, b.cells[i]));
const blank = (): EchoCell => ({ text: ' ', width: 1 });

export class TerminalPredictor {
  private pending: PendingEdit[] = [];
  private actual: EchoScreen | null = null;
  private validated = false;
  private suspended = false;
  private latencies: number[] = [];
  private showing = false;
  private enabled = true;

  setEnabled(enabled: boolean) {
    if (enabled !== this.enabled) { this.reset(); this.enabled = enabled; }
  }

  // Controls, paste and unknown input are boundaries even if they produce no
  // output. Subsequent input still goes to the PTY but is not predicted.
  reset(waitForOutput = false) {
    this.pending = [];
    this.actual = null;
    this.validated = false;
    this.suspended = waitForOutput;
  }

  get timeoutMs() { return Math.max(1000, (Math.max(0, ...this.latencies)) * 3); }
  get deadline() { return this.pending.length ? this.pending[0].sentAt + this.timeoutMs : null; }

  expire(now: number) {
    if (this.deadline !== null && now >= this.deadline) this.reset(true);
  }

  input(data: string, screen: EchoScreen, now: number) {
    this.expire(now);
    if (!this.enabled || this.suspended) return;
    if (!screen.editable || screen.cells.length !== screen.cols || data.length > 256) {
      this.reset(true); return;
    }
    const chars = [...data];
    if (!chars.length || (data !== '\x7f' && data !== '\b' && chars.some(char => predictableWidth(char) === null))) {
      this.reset(true); return;
    }
    if (this.actual && !sameScreen(this.actual, screen)) this.reset();
    this.actual = screen;
    let next = this.pending.at(-1)?.screen ?? screen;
    for (const char of chars) {
      const cells = next.cells.map(cell => ({ ...cell }));
      let x = next.x;
      if (char === '\x7f' || char === '\b') {
        // Only erase speculative text, never the prompt or confirmed text.
        if (x <= screen.x) { this.reset(true); return; }
        let start = x - 1;
        if (cells[start].width === 0) start--;
        if (start < screen.x) { this.reset(true); return; }
        while (x > start) cells[--x] = blank();
      } else {
        const width = predictableWidth(char)!;
        if (x + width >= screen.cols || cells.slice(x).some(cell => cell.width !== 1 || cell.text !== ' ')) {
          this.reset(true); return;
        }
        cells[x] = { text: char, width };
        if (width === 2) cells[x + 1] = { text: '', width: 0 };
        x += width;
      }
      next = { ...next, cells, x };
      this.pending.push({ screen: next, sentAt: now });
      if (this.pending.length > 256) { this.reset(true); return; }
    }
  }

  observe(screen: EchoScreen, now: number) {
    this.expire(now);
    if (!this.enabled) return;
    if (this.suspended) { this.reset(); this.actual = screen; return; }
    if (!screen.editable) { this.reset(); return; }
    if (!this.pending.length) {
      if (this.actual && !sameScreen(this.actual, screen)) this.validated = false;
      this.actual = screen;
      return;
    }
    // A packet may only change SGR attributes or contain an incomplete redraw.
    if (this.actual && sameScreen(this.actual, screen)) return;
    let matched = -1;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (sameScreen(this.pending[i].screen, screen)) { matched = i; break; }
    }
    if (matched < 0) { this.reset(); this.actual = screen; return; }
    const latency = Math.max(0, now - this.pending[matched].sentAt);
    this.latencies.push(latency);
    this.latencies = this.latencies.slice(-12);
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median >= 80) this.showing = true;
    else if (median < 40) this.showing = false;
    this.pending.splice(0, matched + 1);
    this.validated = true;
    this.actual = screen;
  }

  overlay(): EchoOverlay | null {
    const last = this.pending.at(-1)?.screen;
    const actual = this.actual;
    if (!this.enabled || !this.validated || !this.showing || !last || !actual) return null;
    const cells: EchoOverlay['cells'] = [];
    for (let x = 0; x < last.cols; x++) {
      const cell = last.cells[x];
      if (cell.width && !sameCell(cell, actual.cells[x])) cells.push({ ...cell, x });
    }
    if (!cells.length && last.x === actual.x) return null;
    return { cells, x: last.x, y: last.y };
  }
}

// Wails may invoke concurrent calls on different Go goroutines. Preserve input
// order by waiting only for PTY write acceptance, never for its remote echo.
export function terminalInputWriter(send: (data: string) => Promise<void>, fail: (error: unknown) => void) {
  let queue: string[] = [];
  let running = false;
  let disposed = false;
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (queue.length && !disposed) await send(queue.shift()!);
    } catch (error) {
      queue = [];
      if (!disposed) fail(error);
    } finally { running = false; }
  };
  return {
    write(data: string) { if (!disposed) { queue.push(data); void pump(); } },
    dispose() { disposed = true; queue = []; },
  };
}
