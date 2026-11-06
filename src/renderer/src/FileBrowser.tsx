import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Download, File, Folder, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { desktop } from './desktop-api';
import { DownloadStatus } from './DownloadStatus';
import type { DownloadProgress, RemoteDirectory, RemoteFile } from '../../shared/contracts';
import { FilePreview } from './FilePreview';
import { RemotePathInput } from './RemotePathInput';
import { canPreview, readDownloadTask, saveDownloadTask, type DownloadTask } from './file-preview';

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function FileBrowser({ connectionId, serverName, onBack }: { connectionId: string; serverName: string; onBack: () => void }) {
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
  const [path, setPath] = useState('');
  const [filePath, setFilePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState('');
  const [deleting, setDeleting] = useState<RemoteFile | null>(null);
  const mutationBusy = useRef(false);
  const [downloading, setDownloading] = useState('');
  const [task, setTask] = useState<DownloadTask | null>(() => readDownloadTask(connectionId));
  const [cancelling, setCancelling] = useState(false);
  const cancelled = useRef(false);
  const [preview, setPreview] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const activeRequest = useRef('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);

  async function load(target: string) {
    const request = ++generation.current;
    setLoading(true); setDeleting(null); setError(''); setStatus('');
    try {
      const result = await desktop.listFiles(connectionId, target);
      if (!mounted.current || generation.current !== request) return;
      setDirectory(result); setPath(result.path);
    } catch (error) { if (mounted.current && generation.current === request) setError(message(error)); }
    finally { if (mounted.current && generation.current === request) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void load('');
    return () => {
      mounted.current = false; generation.current++;
      if (activeRequest.current) void desktop.cancelDownload(activeRequest.current).catch(() => {});
    };
  }, [connectionId]);

  useEffect(() => desktop.onDownloadProgress(event => {
    if (!mounted.current || event.requestId !== activeRequest.current) return;
    setProgress(current => ({ ...current, ...event }));
  }), []);

  async function download(target: string, folder = false, existing?: DownloadTask) {
    if (activeRequest.current || mutationBusy.current) return;
    if (task && !existing) { setError('请先继续或移除未完成的下载任务'); return; }
    const current = existing ?? { id: crypto.randomUUID(), path: target, folder };
    try { saveDownloadTask(connectionId, current); } catch { setError('无法保存续传记录，请检查本机存储空间'); return; }
    setTask(current);
    const requestId = current.id;
    activeRequest.current = requestId;
    cancelled.current = false; setCancelling(false);
    setProgress(null);
    setDownloading(target); setError(''); setStatus('正在准备下载…');
    try {
      const destination = await (current.folder ? desktop.downloadFolder : desktop.downloadFile)(connectionId, target, requestId);
      if (destination) {
        try { await desktop.forgetDownload(requestId); } catch (error) { if (mounted.current) setError(`已保存文件，缓存清理失败：${message(error)}`); }
        saveDownloadTask(connectionId, null);
        if (mounted.current) setTask(null);
      }
      if (mounted.current) setStatus(destination ? (destination.startsWith('content://') ? '文件已保存到所选位置' : `已保存到 ${destination}`) : '已取消保存，文件缓存已保留，可继续选择保存位置');
    } catch (error) { if (mounted.current) {
      if (cancelled.current) { setStatus(current.folder ? '已停止打包，可重新打包下载' : '已取消下载，进度已保留'); setError(''); }
      else { setError(message(error)); setStatus('下载中断，点击继续下载可重试'); }
    } }
    finally { activeRequest.current = ''; if (mounted.current) { setDownloading(''); setProgress(null); setCancelling(false); } }
  }
  async function cancel() {
    const id = activeRequest.current;
    if (!id) return;
    cancelled.current = true; setCancelling(true);
    try { await desktop.cancelDownload(id); }
    catch (error) { setError(message(error)); setCancelling(false); }
  }
  async function discard() {
    if (!task || activeRequest.current) return;
    try {
      await desktop.forgetDownload(task.id);
      saveDownloadTask(connectionId, null); setTask(null); setError(''); setStatus('已移除下载缓存');
    } catch (error) { setError(message(error)); }
  }

  async function upload() {
    if (!directory || mutationBusy.current || activeRequest.current) return;
    const target = directory.path;
    const requestId = crypto.randomUUID();
    mutationBusy.current = true; activeRequest.current = requestId;
    setDeleting(null); setMutating('upload'); setError(''); setStatus('请选择要上传的文件…');
    setProgress({ requestId, stage: 'uploading' });
    try {
      const remote = await desktop.uploadFile(connectionId, target, requestId);
      if (!mounted.current) return;
      await load(target);
      if (mounted.current) setStatus(remote ? `已上传到 ${remote}` : '已取消上传');
    } catch (error) { if (mounted.current) { setError(message(error)); setStatus(''); } }
    finally {
      mutationBusy.current = false; activeRequest.current = '';
      if (mounted.current) { setMutating(''); setProgress(null); }
    }
  }
  async function remove() {
    if (!deleting || !directory || mutationBusy.current || activeRequest.current) return;
    const entry = deleting, target = directory.path;
    mutationBusy.current = true; setMutating('delete'); setError(''); setStatus('正在删除…');
    try {
      await desktop.deleteFile(connectionId, entry.path);
      if (!mounted.current) return;
      setDeleting(null); await load(target);
      if (mounted.current) setStatus(`已删除 ${entry.name}`);
    } catch (error) {
      if (mounted.current) { await load(target); if (mounted.current) { setDeleting(null); setError(message(error)); } }
    } finally { mutationBusy.current = false; if (mounted.current) setMutating(''); }
  }

  return <main className="files-page">
    <header className="files-header">
      <button onClick={onBack} disabled={!!downloading || !!mutating}><ArrowLeft size={17} />返回终端</button>
      <div><h1>SFTP 文件</h1><small>{serverName}</small></div>
    </header>
    <section className="files-content" aria-label="远端文件浏览器">
      <form className="files-path" onSubmit={event => { event.preventDefault(); if (!mutationBusy.current) void load(path); }}>
        <button type="button" aria-label="上一级目录" disabled={!!mutating || loading || !directory || directory.parent === directory.path} onClick={() => void load(directory!.parent)}><ArrowUp size={17} /></button>
        <RemotePathInput disabled={!!mutating} key={connectionId} connectionId={connectionId} directory={directory} value={path} onChange={setPath} directoriesOnly label="远端目录路径" placeholder="输入远端目录路径" />
        <button disabled={loading || !!mutating}>前往</button>
        <button type="button" aria-label="刷新目录" disabled={loading || !!mutating} onClick={() => void load(directory?.path ?? '')}><RefreshCw size={17} /></button>
      </form>
      <div className="files-upload"><button disabled={!directory || loading || !!mutating || !!downloading} onClick={() => void upload()}><Upload size={16} />{mutating === 'upload' ? '正在上传…' : '上传文件'}</button><small>上传到当前目录，同名文件不会覆盖</small></div>
      <form className="files-direct" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void download(String(data.get('file'))); }}>
        <RemotePathInput key={connectionId} connectionId={connectionId} directory={directory} value={filePath} onChange={setFilePath} name="file" label="远端文件完整路径" placeholder="也可输入文件完整路径直接下载" required disabled={!!downloading || !!mutating} />
        <button disabled={!!task || !!mutating}><Download size={16} />下载</button>
      </form>
      {deleting && <section className="download-resume" role="alertdialog" aria-label="确认删除" aria-describedby="delete-description"><strong>确认删除？</strong><p id="delete-description">{deleting.path}{deleting.isDir ? '（文件夹及其内容将被永久删除；符号链接仅删除链接本身）' : '（永久删除）'}</p><button className="danger" disabled={!!mutating} onClick={() => void remove()}>{mutating === 'delete' ? '正在删除…' : '确认删除'}</button><button disabled={!!mutating} onClick={() => setDeleting(null)}>取消</button></section>}
      {mutating === 'upload' && <DownloadStatus progress={progress} filename={directory?.path ?? ''} />}
      {error && <p className="message" role="alert">{error}</p>}
      {downloading && <><DownloadStatus progress={progress} filename={downloading} /><button disabled={cancelling} onClick={() => void cancel()}><X size={16} />{cancelling ? '正在取消…' : '取消下载（保留进度）'}</button></>}
      {task && !downloading && <section className="download-resume" aria-label="未完成下载"><strong>{task.folder ? '未完成的文件夹下载' : '未完成的下载'}</strong><p>{task.path}</p><button disabled={!!mutating} onClick={() => void download(task.path, task.folder, task)}>{task.folder ? '重新打包 / 保存' : '继续下载 / 保存'}</button><button disabled={!!mutating} onClick={() => void discard()}>移除记录与缓存</button></section>}
      {(!downloading || loading) && <p className="files-status" role="status">{loading ? '正在读取目录…' : status || `${directory?.entries.length ?? 0} 个项目`}</p>}
      <div className="files-list" aria-busy={loading}>
        {directory?.entries.map(entry => <div className="files-row" key={entry.path}>
          <button className="files-name" disabled={!!mutating || loading || (!entry.isDir && !canPreview(entry.name))} onClick={() => entry.isDir ? void load(entry.path) : setPreview(entry.path)} title={entry.isDir ? entry.path : canPreview(entry.name) ? '点击预览' : entry.path}>
            {entry.isDir ? <Folder size={19} /> : <File size={19} />}<span>{entry.name}</span>
          </button>
          <span className="files-size">{entry.isDir ? '文件夹' : size(entry.size)}</span>
          <time className="files-date">{entry.modified ? new Date(entry.modified * 1000).toLocaleString() : ''}</time>
          <div className="files-actions"><button disabled={!!task || !!mutating} aria-label={`${entry.isDir ? '打包下载' : '下载'} ${entry.name}`} onClick={() => void download(entry.path, entry.isDir)}><Download size={16} /><span>{entry.isDir ? '打包 ZIP' : '下载'}</span></button><button className="danger" disabled={loading || !!mutating || !!downloading} aria-label={`删除 ${entry.name}`} onClick={() => setDeleting(entry)}><Trash2 size={16} /><span>删除</span></button></div>
        </div>)}
        {!loading && directory?.entries.length === 0 && <p className="empty">此目录为空</p>}
      </div>
    </section>
    {preview && <FilePreview connectionId={connectionId} path={preview} onClose={() => setPreview('')} />}
  </main>;
}
