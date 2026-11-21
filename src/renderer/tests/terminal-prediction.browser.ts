import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import '../src/styles.css';
import { bindTerminalPrediction, captureEchoScreen } from '../src/terminal-prediction-view';
import cliEchoes from './cli-echoes.json';
import { bindTerminalScrolling } from '../src/terminal-scrolling';

declare global { interface Window { runPredictionTests: () => Promise<unknown> } }
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

window.runPredictionTests = async () => {
  const surface = document.querySelector<HTMLElement>('#term')!;
  const terminal = new Terminal({ cols: 80, rows: 20, fontSize: 16, cursorBlink: false, allowTransparency: true,
    theme: { background: '#00000000', foreground: '#d7e0ea' } });
  terminal.open(surface); terminal.focus();
  const sent: string[] = [];
  const errors: string[] = [];
  const binding = bindTerminalPrediction(terminal, surface, async data => { sent.push(data); }, error => errors.push(String(error)), () => true);
  binding.setEnabled(true);
  const output = async (text: string) => {
    binding.write(new TextEncoder().encode(text));
    // A write callback placed after binding.write runs after its observation.
    await new Promise<void>(resolve => terminal.write('\x1b[0m', resolve));
  };
  const predicted = () => Array.from(surface.querySelectorAll('.terminal-predicted-cell')).map(cell => cell.textContent).join('');
  const key = (name: string, keyCode: number, shiftKey = false) => {
    terminal.textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
      keyCode, which: keyCode, shiftKey, bubbles: true, cancelable: true }));
    terminal.textarea!.dispatchEvent(new KeyboardEvent('keyup', { key: name, keyCode, bubbles: true }));
  };
  const compose = async (text: string) => {
    const textarea = terminal.textarea!;
    textarea.value = '';
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: text, bubbles: true }));
    textarea.value = text;
    await wait(1);
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
    await wait(5); // xterm finalizes composition in a timer, after the DOM event.
  };
  const scenarios: string[] = [];
  await output('$ ');
  key('a', 65);
  check(sent.at(-1) === 'a', 'Real xterm keyboard input must be sent immediately');
  check(!predicted(), 'First unconfirmed character must be hidden');
  await wait(300); await output('a');
  const start = performance.now();
  key('b', 66);
  check(predicted() === 'b', 'Validated input must have an immediate overlay');
  const localLatencyMs = performance.now() - start;
  check(localLatencyMs < 50, `Local display took ${localLatencyMs} ms`);
  check(captureEchoScreen(terminal).cells[3].text === ' ', 'Prediction must not modify xterm buffer');
  terminal.select(0, 0, 5);
  check(terminal.getSelection().trimEnd() === '$ a', 'Selection must not contain unconfirmed input');
  terminal.clearSelection();
  await wait(300); await output('b');
  check(!predicted(), 'Confirmed echo must remove the overlay');
  scenarios.push('300 ms echo delay; immediate display; authoritative buffer and selection unchanged');

  // Confirmed Chinese commits use actual xterm CompositionHelper dispatch.
  await compose('中文');
  check(sent.at(-1) === '中文', 'Chinese commit must be sent once');
  check(predicted() === '中文', 'Chinese commit must predict after prior validation');
  check(surface.querySelectorAll('.terminal-predicted-cell').length === 2, 'CJK must use two wide cells');
  key('Backspace', 8);
  check(predicted() === '中', 'Backspace must delete one pending CJK glyph');
  await output('中文');
  check(predicted() === '  ', 'Pending backspace must mask the acknowledged CJK glyph');
  check(surface.querySelector('.terminal-prediction-mask'), 'Pending backspace must also mask a TUI cursor at the old position');
  await output('\b\b\x1b[K');
  check(!predicted(), 'Wide-character backspace echo must clear prediction');
  scenarios.push('Chinese IME commit, double-width layout and pending backspace');

  await compose('国');
  check(predicted() === '国', 'UTF-8 fragmentation test requires a prediction');
  const encoded = new TextEncoder().encode('国');
  binding.write(encoded.subarray(0, 1));
  await wait(20);
  check(predicted() === '国', 'An incomplete UTF-8 codepoint must not cancel prediction');
  await wait(100);
  binding.write(encoded.subarray(1));
  await wait(20);
  check(!predicted(), 'A reassembled UTF-8 echo must confirm the wide glyph');
  scenarios.push('UTF-8 CJK echo split across transport packets');

  const beforeControls = sent.length;
  key('Tab', 9); key('Tab', 9, true); key('x', 88); key('Enter', 13);
  await wait(1);
  check(JSON.stringify(sent.slice(beforeControls)) === JSON.stringify(['\t', '\x1b[Z', 'x', '\r']), 'Tab, Shift+Tab, text and Enter must preserve bytes and order');
  check(!predicted(), 'Control boundaries must suppress following predictions');
  await output('\r\nPassword: ');
  key('s', 83); key('e', 69);
  check(!predicted(), 'A new non-echoing password prompt must never validate');
  await output('\r\x1b[K\x1b[8mhidden\x1b[0m');
  check(!captureEchoScreen(terminal).editable, 'SGR concealed cells must not be eligible for prediction');
  binding.reset();
  scenarios.push('Tab and Shift+Tab transparency, following input order, password transition');

  // tmux attaches on the alternate buffer. A TUI can redraw the entire input
  // line without echoing contiguous raw input bytes.
  await output('\x1b[?1049h\x1b[2J\x1b[H> ');
  key('a', 65); await wait(100); await output('\r\x1b[K> a');
  key('b', 66);
  check(predicted() === 'b', 'Alternate-screen TUI must be eligible');
  await output('\r\x1b[K\x1b[36m> ab\x1b[0m');
  check(!predicted(), 'ANSI whole-line redraw must confirm the prediction');
  // A terminal-generated DSR reply must not be treated as user input.
  await output('\x1b[6n');
  await wait(1);
  check(sent.at(-1)?.endsWith('R'), 'DSR response must still reach the PTY');
  key('c', 67);
  check(predicted() === 'c', 'DSR must not reset a validated user-input phase');
  await output('\r\x1b[K> unexpected');
  check(!predicted(), 'Conflicting TUI redraw must clear prediction');
  scenarios.push('Alternate screen, ANSI whole-line redraw, DSR passthrough and conflicting redraw');

  key('d', 68); await wait(100); await output('d');
  key('e', 69);
  check(predicted() === 'e', 'Fresh confirmed input must restore prediction');
  binding.setEnabled(false);
  check(!predicted() && !surface.classList.contains('has-prediction'), 'Off switch must restore the real cursor');
  binding.setEnabled(true);
  key('f', 70);
  check(!predicted(), 'Re-enabling must require fresh confirmation');
  await output('f');
  key('g', 71);
  terminal.resize(79, 20);
  check(!predicted(), 'Resize must clear prediction');
  scenarios.push('Off switch, re-enable warmup, resize cleanup');

  binding.reset();
  await output('\r\x1b[K> ');
  key('a', 65); await wait(100); await output('a');
  key('b', 66);
  check(predicted() === 'b', 'Timeout test requires a visible prediction');
  await wait(1100);
  check(!predicted(), 'Stale predictions must expire without output');
  check(errors.length === 0, `Unexpected transport errors: ${errors.join(', ')}`);
  scenarios.push('Stale prediction timeout without any remote response');

  binding.reset();
  await output('\x1b[?1049h\x1b[2J\x1b[H> ');
  key('a', 65); await wait(100); await output('a');
  key('b', 66);
  check(predicted() === 'b', 'History test requires a visible prediction');
  let scrollCalls = 0;
  const scroller = bindTerminalScrolling(terminal, surface, 'tmux', 'test', {
    getTerminalScrollState: async () => ({ lines: 20, position: 20, rows: 20 }),
    scrollTerminal: async () => { scrollCalls++; return { lines: 20, position: 19, rows: 20 }; },
  }, state => { if (state.position < state.lines) binding.reset(true); }, error => { throw error; }, () => true);
  surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true, cancelable: true }));
  check(!predicted(), 'Wheel capture must clear prediction before scroller stops propagation');
  await wait(10);
  check(scrollCalls === 1, 'Prediction must not interfere with remote history scrolling');
  scroller.dispose();
  scenarios.push('Immediate cleanup before tmux history scrolling consumes wheel events');

  // Real PTY captures: input was typed into the named CLI versions; no network
  // request or account is needed to replay these deterministic render traces.
  terminal.resize(80, 24);
  for (const fixture of cliEchoes) {
    binding.reset();
    await output(fixture.initial);
    key('a', 65); await wait(100); await output(fixture.echoes[0].output);
    key('b', 66);
    check(predicted() === 'b', `${fixture.name} must predict after its real first echo`);
    await wait(100); await output(fixture.echoes[1].output);
    check(!predicted(), `${fixture.name} must confirm its actual redraw`);
    await compose('中文');
    check(predicted() === '中文', `${fixture.name} must predict committed Chinese`);
    await output(fixture.echoes[2].output);
    check(!predicted(), `${fixture.name} must match its actual Chinese cell positions`);
    key('Tab', 9);
    check(!predicted(), `${fixture.name} Tab must be a prediction boundary`);
    scenarios.push(`${fixture.name} ${fixture.version} real PTY replay: English, Chinese and Tab boundary`);
  }

  const extraSurface = document.createElement('div');
  extraSurface.className = 'terminal-surface';
  document.body.append(extraSurface);
  const extraTerminal = new Terminal({ cols: 40, rows: 5 });
  extraTerminal.open(extraSurface);
  let extraSends = 0;
  let extraFailures = 0;
  const extraBinding = bindTerminalPrediction(extraTerminal, extraSurface, async () => {
    extraSends++; throw Error('simulated disconnect');
  }, () => { extraFailures++; }, () => true);
  extraBinding.setEnabled(true);
  extraTerminal.input('first', true); extraTerminal.input('queued', true);
  await wait(1);
  check(extraSends === 1 && extraFailures === 1, 'Failed writes must drop queued input');
  extraBinding.stop(); extraBinding.setEnabled(true);
  extraTerminal.input('after disconnect', true);
  check(extraSends === 1, 'A disconnected terminal must stop sending even if its setting changes');
  extraBinding.dispose();
  extraTerminal.input('after disposal', true);
  extraBinding.write(new TextEncoder().encode('late output'));
  check(extraSends === 1 && !extraSurface.querySelector('.terminal-prediction'), 'Disposal must remove input listeners and the overlay');
  extraTerminal.dispose(); extraSurface.remove();
  scenarios.push('Transport failure, queued input discard and disposal with late events');

  // Leave a representative Chinese overlay visible for screenshot inspection.
  binding.reset(); await output('\r\x1b[K> ');
  key('a', 65); await wait(100); await output('a');
  await compose('你好，世界');
  check(predicted() === '你好，世界', 'Repeated IME sessions must retain a validated phase');
  await wait(30);
  const result = { passed: scenarios.length, localLatencyMs: Math.round(localLatencyMs * 100) / 100, scenarios };
  document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
  // The runner closes the page immediately after its screenshot; cleanup is
  // also exercised explicitly without leaving handlers/timers on a dead xterm.
  window.addEventListener('pagehide', () => { binding.dispose(); terminal.dispose(); }, { once: true });
  return result;
};
