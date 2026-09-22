import { describe, expect, it } from 'vitest';
import { attachCommand, normalizeSessionName, parseBackend, parseSessions } from './persistent-shell';

describe('persistent shell helpers', () => {
  it('detects supported multiplexers', () => {
    expect(parseBackend('tmux\n')).toBe('tmux');
    expect(parseBackend('noise\nscreen\n')).toBe('screen');
    expect(parseBackend('')).toBe('none');
  });

  it('normalizes unsafe session names', () => {
    expect(normalizeSessionName(" train/run'; reboot ")).toBe('train-run-reboot');
  });

  it('parses tmux and screen sessions', () => {
    const sep = '\u0001';
    expect(parseSessions('tmux', ['nohop-a', '2', '0', '123'].join(sep))[0]).toMatchObject({ name: 'nohop-a', windows: 2, attached: false });
    expect(parseSessions('screen', '\t123.nohop-a\t(Detached)')[0]).toMatchObject({ name: '123.nohop-a', attached: false });
  });

  it('creates or attaches tmux safely', () => {
    const command = attachCommand('tmux', "bad'; touch /tmp/x", '/data/runs');
    expect(command).not.toContain("'; touch /tmp/x");
    expect(command).toContain("new-session -s 'bad-touch-tmp-x' -c '/data/runs'");
  });
});
