import { Call, Events } from '@wailsio/runtime';
import { downloadAndroidFile } from './android-download';

// Preserve the shared frontend contract while Android uses the v3 transport.
export function installAndroidRuntime() {
  window.go = { main: { App: new Proxy({}, {
    get: (_target, method) => method === 'DownloadFile' ? downloadAndroidFile : (...args: unknown[]) => Call.ByName(`main.App.${String(method)}`, ...args),
  }) as Window['go']['main']['App'] } };
  window.runtime = {
    EventsOn: (name, callback) => Events.On(name, event => callback(event.data)),
  };
  document.documentElement.classList.add('android');
}
