import { Call } from '@wailsio/runtime';

declare global {
  interface Window {
    nohopDownloads?: { saveFile(id: string, path: string): void };
  }
}

// Keep file bytes native: Go stages the file and Java streams it to a document URI.
export async function downloadAndroidFile(connectionId: string, remote: string, requestId: string = crypto.randomUUID()): Promise<string> {
  const native = window.nohopDownloads;
  if (!native) throw new Error('文件导出组件不可用，请更新 Android 安装包');
  const staged = await Call.ByName('main.App.DownloadFile', connectionId, remote, requestId) as string;
  const id = requestId;
  return new Promise<string>((resolve, reject) => {
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
}
