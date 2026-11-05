import type { RemoteFile } from '../../shared/contracts';

export function completionTarget(value: string, base: string) {
  const normalized = value.replace(/\\/g, '/');
  const split = normalized.lastIndexOf('/');
  const parent = split < 0 ? '' : normalized.slice(0, split + 1);
  const absolute = parent.startsWith('/') || /^[a-z]:\//i.test(parent);
  return {
    parent: parent ? (absolute ? parent : `${base.replace(/\/$/, '')}/${parent}`) : base,
    prefix: normalized.slice(split + 1),
  };
}

export function matchingPaths(entries: RemoteFile[], prefix: string, directoriesOnly: boolean) {
  return entries.filter(entry => (!directoriesOnly || entry.isDir) && entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export function completedPath(entry: RemoteFile) {
  return entry.path + (entry.isDir && !entry.path.endsWith('/') ? '/' : '');
}
