export function canPreview(path: string) {
  return /\.(md|markdown|txt|log|pdf|png|jpe?g|gif|webp|bmp)$/i.test(path);
}

export interface DownloadTask { id: string; path: string; folder: boolean }
const taskKey = (connectionId: string) => `nohop.download.${connectionId}`;
export function readDownloadTask(connectionId: string): DownloadTask | null {
  try {
    const task: unknown = JSON.parse(localStorage.getItem(taskKey(connectionId)) ?? 'null');
    if (!task || typeof task !== 'object') return null;
    const value = task as Partial<DownloadTask>;
    return typeof value.id === 'string' && value.id.length > 0 && typeof value.path === 'string' && typeof value.folder === 'boolean' ? value as DownloadTask : null;
  } catch { return null; }
}
export function saveDownloadTask(connectionId: string, task: DownloadTask | null) {
  if (task) localStorage.setItem(taskKey(connectionId), JSON.stringify(task));
  else localStorage.removeItem(taskKey(connectionId));
}
