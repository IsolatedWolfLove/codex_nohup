import { describe, expect, it } from 'vitest';
import { completedPath, completionTarget, matchingPaths, sessionDirectory } from './path-completion';
import type { RemoteFile } from '../../shared/contracts';

const entries: RemoteFile[] = [
  { name: 'project.txt', path: '/home/u/project.txt', isDir: false, size: 10, modified: 0 },
  { name: 'projects', path: '/home/u/projects', isDir: true, size: 0, modified: 0 },
  { name: 'other', path: '/home/u/other', isDir: true, size: 0, modified: 0 },
];

describe('remote path completion', () => {
  it('resolves partial names and relative subdirectories against the displayed directory', () => {
    expect(completionTarget('pro', '/home/u')).toEqual({ parent: '/home/u', prefix: 'pro' });
    expect(completionTarget('projects/sr', '/home/u')).toEqual({ parent: '/home/u/projects/', prefix: 'sr' });
    expect(completionTarget('../pr', '/home/u')).toEqual({ parent: '/home/u/../', prefix: 'pr' });
  });
  it('handles absolute paths, root, spaces, and Windows separators', () => {
    expect(completionTarget('/var/lo', '/home/u')).toEqual({ parent: '/var/', prefix: 'lo' });
    expect(completionTarget('/', '/home/u')).toEqual({ parent: '/', prefix: '' });
    expect(completionTarget('C:\\Program Files\\no', '/home/u')).toEqual({ parent: 'C:/Program Files/', prefix: 'no' });
  });
  it('filters prefixes with directories first and limits directory navigation to folders', () => {
    expect(matchingPaths(entries, 'PRO', false).map(entry => entry.name)).toEqual(['projects', 'project.txt']);
    expect(matchingPaths(entries, 'pro', true).map(entry => entry.name)).toEqual(['projects']);
    expect(matchingPaths(entries, 'missing', false)).toEqual([]);
  });
  it('appends a separator only for directories so completion can continue', () => {
    expect(completedPath(entries[0])).toBe('/home/u/project.txt');
    expect(completedPath(entries[1])).toBe('/home/u/projects/');
  });
});

describe('session working directory', () => {
  it('completes home prefixes against the selected server home', () => {
    expect(completionTarget('~', '/home/alice', '/home/alice')).toEqual({ parent: '/home/alice/', prefix: '' });
    expect(completionTarget('~/pro', '/home/alice', '/home/alice')).toEqual({ parent: '/home/alice/', prefix: 'pro' });
    expect(completionTarget('~/projects/sr', '/home/alice', '/home/alice')).toEqual({ parent: '/home/alice/projects/', prefix: 'sr' });
    expect(completionTarget('~/Do', 'C:/Users/Alice', 'C:/Users/Alice')).toEqual({ parent: 'C:/Users/Alice/', prefix: 'Do' });
  });
  it('launches in the same directory used by completion', () => {
    for (const value of ['', '~', '  ~  ']) expect(sessionDirectory(value, '/home/alice')).toBe('/home/alice');
    expect(sessionDirectory('~/projects', '/home/alice')).toBe('/home/alice/projects');
    expect(sessionDirectory('projects/sub', '/home/alice')).toBe('/home/alice/projects/sub');
    expect(sessionDirectory('/opt/work', '/home/alice')).toBe('/opt/work');
    expect(sessionDirectory('D:/work', 'C:/Users/Alice')).toBe('D:/work');
  });
});
