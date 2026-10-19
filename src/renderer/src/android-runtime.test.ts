import { afterEach, describe, expect, it, vi } from 'vitest';

const { byName, on } = vi.hoisted(() => ({ byName: vi.fn(), on: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: byName }, Events: { On: on } }));
import { installAndroidRuntime } from './android-runtime';
import { desktop } from './desktop-api';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Android runtime adapter', () => {
  it('routes shared SSH calls through v3 names and preserves arguments', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn() } } });
    installAndroidRuntime();
    byName.mockResolvedValue({ terminalId: 'server:session' });
    await desktop.writeTerminal('server:session', '\u0003');
    expect(byName).toHaveBeenCalledWith('main.App.WriteTerminal', 'server:session', '\u0003');
    await desktop.resizeTerminal('server:session', 45, 20);
    expect(byName).toHaveBeenLastCalledWith('main.App.ResizeTerminal', 'server:session', 45, 20);
  });

  it('unwraps event data and returns the native unsubscribe function', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn() } } });
    const unsubscribe = vi.fn();
    on.mockReturnValue(unsubscribe);
    installAndroidRuntime();
    const listener = vi.fn();
    expect(desktop.onTerminalEvent(listener)).toBe(unsubscribe);
    const payload = { type: 'data', terminalId: 'server:session', data: 'YQ==' };
    on.mock.calls[0][1]({ name: 'terminal:event', data: payload });
    expect(listener).toHaveBeenCalledExactlyOnceWith(payload);
  });
});
