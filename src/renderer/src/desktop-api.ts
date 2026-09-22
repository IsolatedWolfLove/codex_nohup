import type { DesktopApi } from '../../shared/desktop-api';

// Wails injects these bindings before loading the application entry point.
// Keep the public frontend contract independent of generated model classes.
type Backend = {
  Connect: DesktopApi['connect']; Disconnect: DesktopApi['disconnect'];
  ListSessions: DesktopApi['listSessions']; OpenSession: DesktopApi['openSession'];
  KillSession: DesktopApi['killSession']; WriteTerminal: DesktopApi['writeTerminal'];
  ResizeTerminal: DesktopApi['resizeTerminal']; CloseTerminal: DesktopApi['closeTerminal'];
  ReadyTerminal: DesktopApi['readyTerminal']; ChoosePrivateKey: DesktopApi['choosePrivateKey'];
  ConfirmKill: DesktopApi['confirmKill'];
};
declare global {
  interface Window {
    go: { main: { App: Backend } };
    runtime: { EventsOn(name: string, callback: Parameters<DesktopApi['onTerminalEvent']>[0]): () => void };
  }
}
export const desktop: DesktopApi = {
  connect: (input) => window.go.main.App.Connect(input),
  disconnect: () => window.go.main.App.Disconnect(),
  listSessions: () => window.go.main.App.ListSessions(),
  openSession: (input) => window.go.main.App.OpenSession(input),
  killSession: (name) => window.go.main.App.KillSession(name),
  writeTerminal: (id, data) => window.go.main.App.WriteTerminal(id, data),
  resizeTerminal: (id, cols, rows) => window.go.main.App.ResizeTerminal(id, cols, rows),
  closeTerminal: (id) => window.go.main.App.CloseTerminal(id),
  readyTerminal: (id) => window.go.main.App.ReadyTerminal(id),
  choosePrivateKey: () => window.go.main.App.ChoosePrivateKey(),
  confirmKill: (name) => window.go.main.App.ConfirmKill(name),
  onTerminalEvent: (callback) => window.runtime.EventsOn('terminal:event', callback),
};
export function decodeTerminalData(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}
