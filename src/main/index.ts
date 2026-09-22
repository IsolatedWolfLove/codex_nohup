import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC } from '../shared/contracts';
import type { ConnectInput, CreateSessionInput } from '../shared/contracts';
import { SshSession } from './ssh-session';

let window: BrowserWindow | null = null;
let session: SshSession | null = null;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0b0f14',
    title: 'Nohop Codex',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  session = new SshSession((event) => window?.webContents.send(IPC.terminalEvent, event));
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  window.on('closed', () => { void session?.disconnect(); session = null; window = null; });
}

function registerIpc(): void {
  ipcMain.handle(IPC.connect, (_event, input: ConnectInput) => session?.connect(input));
  ipcMain.handle(IPC.disconnect, () => session?.disconnect());
  ipcMain.handle(IPC.listSessions, () => session?.listSessions());
  ipcMain.handle(IPC.openSession, (_event, input: CreateSessionInput) => session?.openSession(input));
  ipcMain.handle(IPC.killSession, (_event, name: string) => session?.killSession(name));
  ipcMain.handle(IPC.terminalWrite, (_event, id: string, data: string) => session?.writeTerminal(id, data));
  ipcMain.handle(IPC.terminalResize, (_event, id: string, cols: number, rows: number) => session?.resizeTerminal(id, cols, rows));
  ipcMain.handle(IPC.terminalClose, (_event, id: string) => session?.closeTerminal(id));
  ipcMain.handle(IPC.terminalReady, (_event, id: string) => session?.readyTerminal(id));
  ipcMain.handle(IPC.chooseKey, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: '选择 SSH 私钥' });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

app.whenReady().then(() => { registerIpc(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!window) createWindow(); });
