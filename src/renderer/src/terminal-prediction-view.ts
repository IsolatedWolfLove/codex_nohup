import type { Terminal } from '@xterm/xterm';
import { TerminalPredictor, terminalInputWriter, type EchoScreen } from './terminal-prediction';

export function captureEchoScreen(terminal: Terminal): EchoScreen {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  let hidden = false;
  const cells = Array.from({ length: terminal.cols }, (_, x) => {
    const cell = line?.getCell(x);
    hidden ||= !!cell?.isInvisible();
    const width = cell?.getWidth() ?? 1;
    return { text: cell?.getChars() || (width === 0 ? '' : ' '), width };
  });
  return {
    cells, x: buffer.cursorX, y: buffer.cursorY, baseY: buffer.baseY,
    cols: terminal.cols, buffer: buffer.type,
    editable: !!line && !hidden && buffer.viewportY === buffer.baseY &&
      !terminal.modes.insertMode && terminal.modes.wraparoundMode &&
      // Unicode customization is a proposed API. Without it, xterm 6 uses
      // Unicode 6; never access the guarded getter on a default Terminal.
      (!terminal.options.allowProposedApi || terminal.unicode.activeVersion === '6'),
  };
}

export function bindTerminalPrediction(
  terminal: Terminal, surface: HTMLElement,
  send: (data: string) => Promise<void>, fail: (error: unknown) => void,
  isVisible: () => boolean,
) {
  const predictor = new TerminalPredictor();
  predictor.setEnabled(false);
  const layer = document.createElement('div');
  layer.className = 'terminal-prediction';
  layer.setAttribute('aria-hidden', 'true');
  surface.append(layer);
  let disposed = false;
  let stopped = false;
  let enabled = false;
  let userInput = false;
  let composing = false;
  let compositionCommit = '';
  let parsing = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    if (disposed) return;
    const overlay = enabled && !composing && isVisible() ? predictor.overlay() : null;
    const screen = surface.querySelector<HTMLElement>('.xterm-screen');
    layer.replaceChildren();
    surface.classList.toggle('has-prediction', !!overlay && !!screen);
    if (!overlay || !screen) return;
    const bounds = screen.getBoundingClientRect();
    const parent = surface.getBoundingClientRect();
    const width = bounds.width / terminal.cols;
    const height = bounds.height / terminal.rows;
    Object.assign(layer.style, {
      left: `${bounds.left - parent.left}px`, top: `${bounds.top - parent.top}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
      fontFamily: terminal.options.fontFamily, fontSize: `${terminal.options.fontSize}px`,
      fontWeight: String(terminal.options.fontWeight),
    });
    // Opaque preview tiles also cover software cursors and pending deletions
    // when the authoritative terminal is transparent over a wallpaper.
    const background = terminal.options.allowTransparency ? '#151221' : terminal.options.theme?.background ?? '#080b10';
    for (const cell of overlay.cells) {
      const span = document.createElement('span');
      span.className = 'terminal-predicted-cell';
      span.textContent = cell.text;
      Object.assign(span.style, {
        left: `${cell.x * width}px`, top: `${overlay.y * height}px`,
        width: `${cell.width * width}px`, height: `${height}px`, lineHeight: `${height}px`, background,
      });
      layer.append(span);
    }
    // Some TUIs hide DECTCEM and paint their own inverse-space cursor. When a
    // pending backspace moves left, mask that old blank cursor as well.
    const actual = terminal.buffer.active;
    const cursorCell = actual.getLine(actual.baseY + actual.cursorY)?.getCell(actual.cursorX);
    if (actual.cursorX !== overlay.x && actual.cursorX < terminal.cols &&
        (!cursorCell?.getChars() || cursorCell.getChars() === ' ') &&
        !overlay.cells.some(cell => actual.cursorX >= cell.x && actual.cursorX < cell.x + cell.width)) {
      const mask = document.createElement('span');
      mask.className = 'terminal-prediction-mask';
      Object.assign(mask.style, {
        left: `${actual.cursorX * width}px`, top: `${overlay.y * height}px`,
        width: `${width}px`, height: `${height}px`, background,
      });
      layer.append(mask);
    }
    const cursor = document.createElement('span');
    cursor.className = 'terminal-predicted-cursor';
    Object.assign(cursor.style, {
      left: `${overlay.x * width}px`, top: `${overlay.y * height}px`, width: `${width}px`, height: `${height}px`,
    });
    layer.append(cursor);
  };
  const armTimeout = () => {
    clearTimeout(timeout);
    const deadline = predictor.deadline;
    if (deadline !== null) timeout = setTimeout(() => {
      predictor.expire(performance.now()); paint(); armTimeout();
    }, Math.max(1, deadline - performance.now()));
  };
  const reset = (waitForOutput = false) => {
    predictor.reset(waitForOutput); clearTimeout(timeout); paint();
  };
  const writer = terminalInputWriter(send, error => { reset(true); fail(error); });
  const markUserInput = () => {
    userInput = true;
    queueMicrotask(() => { userInput = false; });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || composing) return;
    compositionCommit = '';
    markUserInput();
    if (event.ctrlKey || event.altKey || event.metaKey ||
        (event.key.length !== 1 && !['Backspace', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key))) reset(true);
  };
  const textInput = (event: Event) => {
    const input = event as InputEvent;
    if (composing || input.isComposing) return;
    if (input.inputType === 'insertFromPaste') { reset(true); return; }
    markUserInput();
  };
  const compositionStart = () => { composing = true; compositionCommit = ''; paint(); };
  const compositionEnd = (event: CompositionEvent) => {
    composing = false;
    compositionCommit = event.data;
    markUserInput();
  };
  const paste = () => { compositionCommit = ''; reset(true); };
  const leave = () => { compositionCommit = ''; reset(); };
  surface.addEventListener('keydown', keydown, true);
  surface.addEventListener('input', textInput, true);
  surface.addEventListener('compositionstart', compositionStart, true);
  surface.addEventListener('compositionend', compositionEnd, true);
  surface.addEventListener('paste', paste, true);
  surface.addEventListener('wheel', paste, true);
  surface.addEventListener('touchstart', paste, true);
  surface.addEventListener('focusout', leave, true);
  const visibility = () => { if (document.visibilityState !== 'visible') leave(); };
  document.addEventListener('visibilitychange', visibility);

  const input = terminal.onData(data => {
    // DSR and device replies also use onData. They must be sent, but must not
    // enter the predictor or establish that a program echoes user input.
    const fromUser = userInput || (!!compositionCommit && data === compositionCommit);
    userInput = false;
    if (fromUser) {
      compositionCommit = '';
      if (enabled && !composing && !parsing && isVisible()) predictor.input(data, captureEchoScreen(terminal), performance.now());
      else predictor.reset(true);
      paint(); armTimeout();
    }
    writer.write(data);
  });
  const key = terminal.onKey(markUserInput);
  const render = terminal.onRender(paint);
  const resize = terminal.onResize(() => reset());
  const scroll = terminal.onScroll(() => reset());
  const buffer = terminal.buffer.onBufferChange(() => reset());

  return {
    setEnabled(value: boolean) {
      enabled = value && !stopped; predictor.setEnabled(enabled); paint(); armTimeout();
    },
    reset,
    stop() {
      stopped = true; enabled = false;
      writer.dispose(); predictor.setEnabled(false); reset(true);
    },
    write(data: Uint8Array) {
      if (disposed) return;
      parsing++;
      terminal.write(data, () => {
        if (disposed) return;
        parsing--;
        if (enabled) predictor.observe(captureEchoScreen(terminal), performance.now());
        paint(); armTimeout();
      });
    },
    dispose() {
      disposed = true;
      clearTimeout(timeout); writer.dispose(); predictor.reset();
      input.dispose(); key.dispose(); render.dispose(); resize.dispose(); scroll.dispose(); buffer.dispose();
      surface.removeEventListener('keydown', keydown, true);
      surface.removeEventListener('input', textInput, true);
      surface.removeEventListener('compositionstart', compositionStart, true);
      surface.removeEventListener('compositionend', compositionEnd, true);
      surface.removeEventListener('paste', paste, true);
      surface.removeEventListener('wheel', paste, true);
      surface.removeEventListener('touchstart', paste, true);
      surface.removeEventListener('focusout', leave, true);
      document.removeEventListener('visibilitychange', visibility);
      surface.classList.remove('has-prediction'); layer.remove();
    },
  };
}
