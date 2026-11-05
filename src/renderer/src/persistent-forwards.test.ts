import { describe, expect, it, vi } from 'vitest';
import { PersistentForwards, forwardKey } from './persistent-forwards';
import type { PortForward, PortForwardInput } from '../../shared/contracts';

const local: PortForwardInput = { direction: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'localhost', targetPort: 80 };
const remote: PortForwardInput = { ...local, direction: 'remote', listenPort: 9090 };
function setup() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value); }) };
  const live = new Map<string, PortForward[]>();
  let counter = 0;
  const api = {
    listPortForwards: vi.fn(async (id: string) => [...(live.get(id) ?? [])]),
    startPortForward: vi.fn(async (id: string, input: PortForwardInput) => {
      const value = { ...input, id: `runtime-${++counter}`, lastError: '' };
      live.set(id, [...(live.get(id) ?? []), value]); return value;
    }),
    stopPortForward: vi.fn(async (id: string, runtimeId: string) => { live.set(id, (live.get(id) ?? []).filter(item => item.id !== runtimeId)); }),
  };
  return { data, storage, live, api, store: new PersistentForwards(api, () => storage) };
}

describe('persistent SSH port forwards', () => {
  it('saves both directions and rebuilds new runtime IDs after a transport disconnect', async () => {
    const { store, live, api, data } = setup();
    await store.start('a', local); await store.start('a', remote);
    const oldIds = live.get('a')!.map(item => item.id);
    expect([...data.values()].join()).not.toContain('runtime-');
    live.clear();
    await store.restore('a');
    expect(live.get('a')!.map(item => item.id)).not.toEqual(oldIds);
    expect((await store.list('a')).every(item => item.running)).toBe(true);
    expect(api.startPortForward).toHaveBeenCalledTimes(4);
  });
  it('restores saved rules after an app restart, isolating servers', async () => {
    const { store, live, api, storage } = setup();
    await store.start('a', local); await store.start('b', remote);
    live.clear();
    const restarted = new PersistentForwards(api, () => storage);
    await restarted.restore('a');
    expect(live.get('a')).toHaveLength(1);
    expect(live.get('b')).toBeUndefined();
    await restarted.restore('b');
    expect(live.get('b')![0].direction).toBe('remote');
  });
  it('serializes concurrent recovery, retries, and starts without duplicate listeners', async () => {
    const { store, live, api } = setup();
    await store.start('a', local); live.clear();
    await Promise.all([store.restore('a'), store.restore('a'), store.start('a', local)]);
    expect(live.get('a')).toHaveLength(1);
    expect(api.startPortForward).toHaveBeenCalledTimes(2);
  });
  it('keeps failed rules visible and restores other rules even when a port is busy', async () => {
    const { store, live, api } = setup();
    await store.start('a', local); await store.start('a', remote); live.clear();
    api.startPortForward.mockRejectedValueOnce(new Error('address already in use'));
    await store.restore('a');
    const rows = await store.list('a');
    expect(rows.find(item => item.direction === 'local')).toMatchObject({ running: false, lastError: 'address already in use' });
    expect(rows.find(item => item.direction === 'remote')?.running).toBe(true);
    await store.restore('a');
    expect((await store.list('a')).every(item => item.running && !item.lastError)).toBe(true);
  });
  it('removes a stopped rule so a queued reconnect and app restart cannot revive it', async () => {
    const { store, live, api, storage } = setup();
    await store.start('a', local); live.clear();
    await Promise.all([store.restore('a'), store.stop('a', forwardKey(local)), store.restore('a')]);
    expect(live.get('a')).toEqual([]);
    await new PersistentForwards(api, () => storage).restore('a');
    expect(await store.list('a')).toEqual([]);
  });
  it('adopts existing running forwards created by the previous application version', async () => {
    const { store, api, live } = setup();
    await api.startPortForward('a', local);
    expect(await store.list('a')).toHaveLength(1);
    live.clear(); await store.restore('a');
    expect(live.get('a')).toHaveLength(1);
  });
  it('does not start an untracked tunnel when persistence fails or input is invalid', async () => {
    const { store, api, storage } = setup();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    await expect(store.start('a', local)).rejects.toThrow('无法保存');
    await expect(store.start('a', { ...local, targetPort: 0 })).rejects.toThrow('有效');
    expect(api.startPortForward).not.toHaveBeenCalled();
  });
  it('keeps unsuccessful initial starts saved and exposes transport failures in the list', async () => {
    const { store, api } = setup();
    api.listPortForwards.mockRejectedValue(new Error('SSH disconnected'));
    await expect(store.start('a', local)).rejects.toThrow('SSH disconnected');
    expect(await store.list('a')).toMatchObject([{ running: false, lastError: 'SSH disconnected' }]);
    api.listPortForwards.mockResolvedValue([]);
    await store.restore('a');
    expect(api.startPortForward).toHaveBeenCalledWith('a', local);
  });
  it('keeps a rule available if stopping its listener fails', async () => {
    const { store, api } = setup();
    await store.start('a', local);
    api.stopPortForward.mockRejectedValueOnce(new Error('bridge unavailable'));
    await expect(store.stop('a', forwardKey(local))).rejects.toThrow('bridge unavailable');
    expect(await store.list('a')).toMatchObject([{ running: true }]);
  });
  it('cancels recovery and closes a newly created listener when a server is removed mid-request', async () => {
    const { store, api, live } = setup();
    await store.start('a', local); live.clear();
    await store.restore('a', () => true);
    expect(api.startPortForward).toHaveBeenCalledTimes(1);
    let cancelled = false;
    const start = api.startPortForward.getMockImplementation()!;
    api.startPortForward.mockImplementationOnce(async (id, input) => { const value = await start(id, input); cancelled = true; return value; });
    await store.restore('a', () => cancelled);
    expect(live.get('a')).toEqual([]);
  });
});
