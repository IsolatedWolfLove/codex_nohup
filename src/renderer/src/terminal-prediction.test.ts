import { describe, expect, it, vi } from 'vitest';
import { TerminalPredictor, predictableWidth, readPredictionMode, terminalInputWriter, type EchoScreen } from './terminal-prediction';

function screen(text = '$ ', overrides: Partial<EchoScreen> = {}): EchoScreen {
  const cells: EchoScreen['cells'][number][] = [];
  for (const char of text) {
    const width = predictableWidth(char) ?? 1;
    cells.push({ text: char, width });
    if (width === 2) cells.push({ text: '', width: 0 });
  }
  const x = cells.length;
  while (cells.length < 40) cells.push({ text: ' ', width: 1 });
  return { cells, x, y: 2, baseY: 0, cols: 40, buffer: 'normal', editable: true, ...overrides };
}
function warm(latency = 300, buffer: EchoScreen['buffer'] = 'normal') {
  const predictor = new TerminalPredictor();
  predictor.input('a', screen('$ ', { buffer }), 0);
  expect(predictor.overlay()).toBeNull();
  predictor.observe(screen('$ a', { buffer }), latency);
  return predictor;
}

describe('display-only terminal prediction', () => {
  it.each([0, 100, 300, 600])('uses observed echo latency (%i ms), not PTY write acceptance', latency => {
    const predictor = warm(latency);
    predictor.input('b', screen('$ a'), latency + 10);
    if (latency >= 80) expect(predictor.overlay()?.cells).toEqual([{ text: 'b', width: 1, x: 3 }]);
    else expect(predictor.overlay()).toBeNull();
  });

  it('confirms split echoes and removes only acknowledged display cells', () => {
    const predictor = warm();
    const authoritative = screen('$ a');
    predictor.input('bc', authoritative, 310);
    expect(predictor.overlay()?.cells.map(cell => cell.text).join('')).toBe('bc');
    predictor.observe(screen('$ ab'), 600);
    expect(predictor.overlay()?.cells).toEqual([{ text: 'c', width: 1, x: 4 }]);
    predictor.observe(screen('$ abc'), 610);
    expect(predictor.overlay()).toBeNull();
    expect(authoritative).toEqual(screen('$ a'));
  });

  it('accepts a coalesced echo or an equivalent whole-line redraw', () => {
    const predictor = warm();
    predictor.input('bc', screen('$ a'), 310);
    predictor.observe(screen('$ abc'), 620);
    expect(predictor.overlay()).toBeNull();
    predictor.input('d', screen('$ abc'), 630);
    expect(predictor.overlay()?.cells[0].text).toBe('d');
  });

  it('uses the same prediction rules inside tmux and an alternate-screen TUI', () => {
    const predictor = warm(300, 'alternate');
    predictor.input('中文，', screen('$ a', { buffer: 'alternate' }), 310);
    expect(predictor.overlay()).toEqual({ cells: [
      { text: '中', width: 2, x: 3 }, { text: '文', width: 2, x: 5 }, { text: '，', width: 2, x: 7 },
    ], x: 9, y: 2 });
    predictor.observe(screen('$ a中文，', { buffer: 'alternate' }), 610);
    expect(predictor.overlay()).toBeNull();
  });

  it('erases pending wide characters without erasing the prompt or confirmed text', () => {
    const predictor = warm();
    predictor.input('中文', screen('$ a'), 310);
    predictor.input('\x7f', screen('$ a'), 320);
    expect(predictor.overlay()?.cells).toEqual([{ text: '中', width: 2, x: 3 }]);
    predictor.observe(screen('$ a中文'), 610);
    // The deletion is still pending: mask both cells of the real wide glyph.
    expect(predictor.overlay()?.cells).toEqual([{ text: ' ', width: 1, x: 5 }, { text: ' ', width: 1, x: 6 }]);
    predictor.observe(screen('$ a中'), 620);
    expect(predictor.overlay()).toBeNull();
    predictor.input('\x7f', screen('$ a中'), 630);
    expect(predictor.overlay()).toBeNull();
  });

  it.each(['\t', '\x1b[Z', '\r', '\x1b', '\x1b[A', '\x03', '\x1b[200~paste\x1b[201~', '🙂', 'e\u0301', '\u302a'])('treats %j as an unpredicted boundary', data => {
    const predictor = warm();
    predictor.input('b', screen('$ a'), 310);
    predictor.input(data, screen('$ a'), 320);
    predictor.input('c', screen('$ a'), 330);
    expect(predictor.overlay()).toBeNull();
    predictor.observe(screen('$ completed'), 620);
    predictor.input('d', screen('$ completed'), 630);
    expect(predictor.overlay()).toBeNull();
    predictor.observe(screen('$ completedd'), 930);
    predictor.input('e', screen('$ completedd'), 940);
    expect(predictor.overlay()?.cells[0].text).toBe('e');
  });

  it('does not display anything in a new non-echoing password stage', () => {
    const predictor = warm();
    predictor.input('\r', screen('$ a'), 310);
    predictor.observe(screen('Password: '), 600);
    predictor.input('secret', screen('Password: '), 610);
    expect(predictor.overlay()).toBeNull();
    predictor.expire(2000);
    predictor.input('more', screen('Password: '), 2010);
    expect(predictor.overlay()).toBeNull();
  });

  it('drops conflicting predictions and requires a fresh confirmed echo', () => {
    const predictor = warm();
    predictor.input('b', screen('$ a'), 310);
    predictor.observe(screen('new prompt> '), 400);
    expect(predictor.overlay()).toBeNull();
    predictor.input('x', screen('new prompt> '), 410);
    expect(predictor.overlay()).toBeNull();
  });

  it('ignores unchanged snapshots (including style-only output) and expires stale predictions', () => {
    const predictor = warm();
    predictor.input('b', screen('$ a'), 310);
    predictor.observe(screen('$ a'), 400);
    expect(predictor.overlay()).not.toBeNull();
    predictor.expire(1309);
    expect(predictor.overlay()).not.toBeNull();
    predictor.expire(1310);
    expect(predictor.overlay()).toBeNull();
    predictor.input('c', screen('$ a'), 1320);
    expect(predictor.overlay()).toBeNull();
  });

  it('resets on resize, cursor jumps, buffer changes, history and hidden cells', () => {
    for (const changes of [{ cols: 41 }, { y: 3 }, { x: 0 }, { buffer: 'alternate' as const }, { editable: false }]) {
      const predictor = warm();
      predictor.input('b', screen('$ a'), 310);
      predictor.observe(screen('$ ab', changes), 600);
      expect(predictor.overlay()).toBeNull();
    }
  });

  it('falls back at the right margin and for edits before a nonblank suffix', () => {
    for (const state of [screen('x'.repeat(39)), screen('$ abc', { x: 3 })]) {
      const predictor = new TerminalPredictor();
      predictor.input('a', state, 0);
      expect(predictor.deadline).toBeNull();
    }
  });

  it('bounds pending input and keeps terminals isolated', () => {
    const first = warm();
    const second = warm();
    first.input('b', screen('$ a'), 310);
    expect(first.overlay()).not.toBeNull();
    expect(second.overlay()).toBeNull();
    second.setEnabled(false);
    first.input('x'.repeat(257), screen('$ a'), 320);
    expect(first.deadline).toBeNull();
  });

  it('disables immediately and requires confirmation when enabled again', () => {
    const predictor = warm();
    predictor.input('b', screen('$ a'), 310);
    predictor.setEnabled(false);
    expect(predictor.overlay()).toBeNull();
    predictor.setEnabled(true);
    predictor.input('b', screen('$ a'), 320);
    expect(predictor.overlay()).toBeNull();
  });

  it('uses hysteresis when latency moves between the on and off thresholds', () => {
    const predictor = warm(300);
    let text = '$ a';
    let now = 310;
    for (const latency of [...Array<number>(13).fill(50), ...Array<number>(13).fill(20)]) {
      predictor.input('a', screen(text), now);
      expect(predictor.overlay() !== null).toBe(now < 310 + 13 * 100 + 7 * 100);
      text += 'a';
      predictor.observe(screen(text), now + latency);
      now += 100;
    }
  });
});

describe('terminal input transport', () => {
  it('preserves exact bytes and order through Tab, repeated Tab, text and Enter without waiting for echo', async () => {
    const received: string[] = [];
    const releases: Array<() => void> = [];
    const writer = terminalInputWriter(data => {
      received.push(data);
      return new Promise<void>(resolve => releases.push(resolve));
    }, vi.fn());
    const input = ['中', '\t', '\t', 'x', '\r'];
    input.forEach(data => writer.write(data));
    expect(received).toEqual(['中']);
    for (let i = 0; i < input.length; i++) { releases[i](); await Promise.resolve(); }
    expect(received).toEqual(input);
    writer.dispose();
  });

  it('drops queued input after failure or disposal and never replays it', async () => {
    const fail = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error('disconnected'));
    const writer = terminalInputWriter(send, fail);
    writer.write('a'); writer.write('b');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
    writer.dispose(); writer.write('c');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('prediction setting', () => {
  it('defaults to auto even with unavailable storage', () => {
    expect(readPredictionMode({ getItem: () => null })).toBe('auto');
    expect(readPredictionMode({ getItem: () => 'unexpected' })).toBe('auto');
    expect(readPredictionMode({ getItem: () => { throw Error('storage disabled'); } })).toBe('auto');
    expect(readPredictionMode({ getItem: () => 'off' })).toBe('off');
  });
});
