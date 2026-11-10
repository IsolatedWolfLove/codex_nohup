// Uses the installed Chromium/Chrome and Node's built-in CDP WebSocket client;
// no browser download or additional npm dependency is required.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const profile = await mkdtemp(join(tmpdir(), 'nohop-prediction-chrome-'));
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
let chrome;
let socket;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeError = '';
  chrome.stderr.on('data', chunk => { chromeError = (chromeError + chunk).slice(-3000); });
  chrome.on('error', error => { chromeError = error.message; });
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await delay(100); }
  }
  if (!debugPort) throw Error(`Chrome did not start. Set CHROME_BIN to a Chromium executable. ${chromeError}`);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callbacks = pending.get(message.id);
      if (!callbacks) return;
      pending.delete(message.id);
      if (message.error) callbacks.reject(Error(message.error.message));
      else callbacks.resolve(message.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/terminal-prediction.html` });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!window.runPredictionTests')) { ready = true; break; }
    await delay(100);
  }
  if (!ready) throw Error('Browser fixture did not load');
  let testTimeout;
  let result;
  try {
    result = await Promise.race([
      evaluate('window.runPredictionTests()'),
      new Promise((_, reject) => { testTimeout = setTimeout(() => reject(Error('Browser tests exceeded 45 seconds')), 45000); }),
    ]);
  } finally { clearTimeout(testTimeout); }
  console.log(JSON.stringify(result, null, 2));
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = join(tmpdir(), 'nohop-terminal-prediction.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, delay(2000)]);
  }
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
