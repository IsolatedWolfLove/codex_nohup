import { Call } from '@wailsio/runtime';

declare global {
  interface Window {
    nohopDownloads?: { saveFile(id: string, path: string): void; cancel?(id: string): void };
  }
}

// Keep file bytes native: Go stages the file and Java streams it to a document URI.
export async function downloadAndroidFile(connectionId: string, remote: string, requestId: string = crypto.randomUUID()): Promise<string> {
  return exportAndroidDownload('DownloadFile', connectionId, remote, requestId);
}
export async function downloadAndroidFolder(connectionId: string, remote: string, requestId: string): Promise<string> {
  return exportAndroidDownload('DownloadFolder', connectionId, remote, requestId);
}

async function exportAndroidDownload(method: string, connectionId: string, remote: string, requestId: string): Promise<string> {
  const native = window.nohopDownloads;
  if (!native) throw new Error('文件导出组件不可用，请更新 Android 安装包');
  let cancelled = false;
  const cancel = (event: Event) => {
    if ((event as CustomEvent<string>).detail !== requestId) return;
    cancelled = true;
    native.cancel?.(requestId);
  };
  window.addEventListener('nohop:download-cancel', cancel);
  try {
    const staged = await Call.ByName(`main.App.${method}`, connectionId, remote, requestId) as string;
    if (cancelled) throw new Error('已取消下载，进度已保留');
    const id = requestId;
    return await new Promise<string>((resolve, reject) => {
      const finish = (event: Event) => {
        const result = (event as CustomEvent<{ id: string; destination: string; error: string }>).detail;
        if (result?.id !== id) return;
        window.removeEventListener('nohop:download-export', finish);
        if (result.error) reject(new Error(result.error));
        else resolve(result.destination);
      };
      window.addEventListener('nohop:download-export', finish);
      window.dispatchEvent(new CustomEvent('nohop:download-progress', { detail: { requestId: id, stage: 'choosing' } }));
      try { native.saveFile(id, staged); }
      catch (error) {
        window.removeEventListener('nohop:download-export', finish);
        reject(error);
      }
    });
  } finally { window.removeEventListener('nohop:download-cancel', cancel); }
}
