import { afterEach, describe, expect, it, vi } from 'vitest';

const { byName } = vi.hoisted(() => ({ byName: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: byName } }));
import { downloadAndroidFile } from './android-download';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function setup() {
  vi.stubGlobal('CustomEvent', class extends Event { detail: unknown; constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail; } });
  const target = new EventTarget();
  const saveFile = vi.fn();
  vi.stubGlobal('window', Object.assign(target, { nohopDownloads: { saveFile } }));
  byName.mockResolvedValue('/private/sftp-downloads/download-token/report.pdf');
  const result = (id: string, destination: string, error = '') => {
    const event = new Event('nohop:download-export');
    Object.assign(event, { detail: { id, destination, error } });
    target.dispatchEvent(event);
  };
  return { saveFile, result };
}

describe('Android native file export', () => {
  it('waits for the matching system export result and returns the document URI', async () => {
    const { saveFile, result } = setup();
    const stages: unknown[] = [];
    window.addEventListener('nohop:download-progress', event => stages.push((event as CustomEvent).detail));
    const pending = downloadAndroidFile('server-2', '/work/report.pdf', 'download-123');
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(byName).toHaveBeenCalledWith('main.App.DownloadFile', 'server-2', '/work/report.pdf', 'download-123');
    const [id, path] = saveFile.mock.calls[0];
    expect(id).toBe('download-123');
    expect(stages).toEqual([{ requestId: 'download-123', stage: 'choosing' }]);
    expect(path).toBe('/private/sftp-downloads/download-token/report.pdf');
    let finished = false;
    void pending.then(() => { finished = true; });
    result('another-export', 'content://wrong');
    await Promise.resolve();
    expect(finished).toBe(false);
    result(id, 'content://documents/report.pdf');
    await expect(pending).resolves.toBe('content://documents/report.pdf');
  });

  it('handles picker cancellation as a normal empty result', async () => {
    const { saveFile, result } = setup();
    const pending = downloadAndroidFile('server', '/file');
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    result(saveFile.mock.calls[0][0], '');
    await expect(pending).resolves.toBe('');
  });

  it('reports provider write errors', async () => {
    const { saveFile, result } = setup();
    const pending = downloadAndroidFile('server', '/file');
    const rejected = expect(pending).rejects.toThrow('存储空间不足');
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    result(saveFile.mock.calls[0][0], '', '存储空间不足');
    await rejected;
  });

  it('does not start a download if the installed APK has no export bridge', async () => {
    vi.stubGlobal('window', {});
    await expect(downloadAndroidFile('server', '/file')).rejects.toThrow('请更新 Android 安装包');
    expect(byName).not.toHaveBeenCalled();
  });

  it('does not open the picker for an incomplete SFTP download', async () => {
    const { saveFile } = setup();
    byName.mockRejectedValue(new Error('连接中断'));
    await expect(downloadAndroidFile('server', '/file')).rejects.toThrow('连接中断');
    expect(saveFile).not.toHaveBeenCalled();
  });
});
