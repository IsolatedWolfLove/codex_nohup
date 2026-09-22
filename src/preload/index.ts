import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/contracts';
import type { ElectronApi } from '../shared/electron-api';

const api: ElectronApi = {
  connect: (input) => ipcRenderer.invoke(IPC.connect, input),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  openSession: (input) => ipcRenderer.invoke(IPC.openSession, input),
  killSession: (name) => ipcRenderer.invoke(IPC.killSession, name),
  writeTerminal: (id, data) => ipcRenderer.invoke(IPC.terminalWrite, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke(IPC.terminalResize, id, cols, rows),
  closeTerminal: (id) => ipcRenderer.invoke(IPC.terminalClose, id),
  readyTerminal: (id) => ipcRenderer.invoke(IPC.terminalReady, id),
  choosePrivateKey: () => ipcRenderer.invoke(IPC.chooseKey),
  onTerminalEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
    ipcRenderer.on(IPC.terminalEvent, listener);
    return () => ipcRenderer.removeListener(IPC.terminalEvent, listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
