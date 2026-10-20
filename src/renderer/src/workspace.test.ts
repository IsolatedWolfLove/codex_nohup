import { describe, expect, it } from 'vitest';
import { readWorkspace, reconnectDelay, safeConnection } from './workspace';
import type { ConnectInput } from '../../shared/contracts';

const input: ConnectInput = { connectionId: 'server-a', host: 'example.com', port: 22, username: 'user', authMethod: 'privateKey', privateKeyPath: '/keys/work', password: 'secret-password', passphrase: 'secret-passphrase' };
describe('workspace persistence', () => {
  it('removes secrets on save and when loading previously stored data', () => {
    const safe = safeConnection(input);
    expect(safe).not.toHaveProperty('password');
    expect(safe).not.toHaveProperty('passphrase');
    const saved = readWorkspace(JSON.stringify({ servers: [input], tabs: [] }));
    expect(JSON.stringify(saved)).not.toContain('secret-');
    expect(saved?.servers[0].privateKeyPath).toBe('/keys/work');
  });
  it('restores multiple hosts, pane order, active pane and layout', () => {
    const tabs = [{ key: 'one', connectionId: 'server-a', name: 'work', cwd: '/work' }, { key: 'two', connectionId: 'server-b', name: 'work', cwd: '/other' }];
    const saved = readWorkspace(JSON.stringify({ servers: [input, { ...input, connectionId: 'server-b' }], tabs, selected: 'server-b', active: 'two', layout: 'columns' }));
    expect(saved?.tabs).toEqual(tabs);
    expect(saved?.selected).toBe('server-b');
    expect(saved?.active).toBe('two');
    expect(saved?.layout).toBe('columns');
  });
  it('discards invalid data and orphaned tabs', () => {
    expect(readWorkspace('{')).toBeNull();
    expect(readWorkspace('null')).toBeNull();
    const saved = readWorkspace(JSON.stringify({ servers: [input, { ...input, connectionId: 'bad:id' }, null], tabs: [{ key: 'lost', connectionId: 'missing', name: 'work', cwd: '' }], layout: 'invalid', selected: 'missing' }));
    expect(saved?.servers).toHaveLength(1);
    expect(saved?.tabs).toEqual([]);
    expect(saved?.layout).toBe('single');
    expect(saved?.selected).toBe('server-a');
  });
  it('backs off reconnection attempts with a 30 second ceiling', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

it('restores a native local connection without turning it into SSH', () => {
  const local: ConnectInput = { connectionId: 'local-desktop', local: true, alias: '本机', host: '本机', port: 22, username: '', authMethod: 'auto' };
  const saved = readWorkspace(JSON.stringify({ servers: [safeConnection(local)], tabs: [{ key: 'native', connectionId: local.connectionId, name: 'work', cwd: '' }] }));
  expect(saved?.servers[0].local).toBe(true);
  expect(saved?.tabs[0].connectionId).toBe(local.connectionId);
});
