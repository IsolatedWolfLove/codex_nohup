import { describe, expect, it } from 'vitest';
import { completedPath, completionTarget, matchingPaths } from './path-completion';
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
