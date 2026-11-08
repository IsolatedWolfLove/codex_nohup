import { Call, Events, Window as NativeWindow } from '@wailsio/runtime';

export const detachTerminal = (payload: string) => Call.ByName('main.App.DetachTerminal', payload);
export const syncDetached = (payload: string) => Call.ByName('main.App.SyncDetached', payload);
export function installNativeRuntime() {
  window.go = { main: { App: new Proxy({}, {
    get: (_target, method) => (...args: unknown[]) => Call.ByName(`main.App.${String(method)}`, ...args),
  }) as Window['go']['main']['App'] } };
  window.runtime = {
    EventsOn: (name, callback) => Events.On(name, event => callback(event.data)),
    ...{ WindowMinimise: () => NativeWindow.Minimise(), WindowToggleMaximise: () => NativeWindow.ToggleMaximise(), Quit: () => NativeWindow.Close() },
  };
}
export const closeNativeWindow = () => NativeWindow.Close();
