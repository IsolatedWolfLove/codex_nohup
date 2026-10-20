import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Download, File, Folder, RefreshCw } from 'lucide-react';
import { desktop } from './desktop-api';
import { DownloadStatus } from './DownloadStatus';
import type { DownloadProgress, RemoteDirectory } from '../../shared/contracts';

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function FileBrowser({ connectionId, serverName, onBack }: { connectionId: string; serverName: string; onBack: () => void }) {
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const activeRequest = useRef('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);

  async function load(target: string) {
    const request = ++generation.current;
    setLoading(true); setError(''); setStatus('');
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
    return () => { mounted.current = false; generation.current++; };
  }, [connectionId]);

  useEffect(() => desktop.onDownloadProgress(event => {
    if (event.requestId !== activeRequest.current) return;
    setProgress(current => ({ ...current, ...event }));
  }), []);

  async function download(target: string) {
    if (activeRequest.current) return;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setProgress(null);
    setDownloading(target); setError(''); setStatus('正在准备下载…');
    try {
      const destination = await desktop.downloadFile(connectionId, target, requestId);
      if (mounted.current) setStatus(destination ? (destination.startsWith('content://') ? '文件已保存到所选位置' : `已保存到 ${destination}`) : '已取消下载');
    } catch (error) { if (mounted.current) { setError(message(error)); setStatus(''); } }
    finally { activeRequest.current = ''; if (mounted.current) { setDownloading(''); setProgress(null); } }
  }

  return <main className="files-page">
    <header className="files-header">
      <button onClick={onBack} disabled={!!downloading}><ArrowLeft size={17} />返回终端</button>
      <div><h1>SFTP 文件</h1><small>{serverName}</small></div>
    </header>
    <section className="files-content" aria-label="远端文件浏览器">
      <form className="files-path" onSubmit={event => { event.preventDefault(); void load(path); }}>
        <button type="button" aria-label="上一级目录" disabled={loading || !directory || directory.parent === directory.path} onClick={() => void load(directory!.parent)}><ArrowUp size={17} /></button>
        <input aria-label="远端目录路径" value={path} onChange={event => setPath(event.target.value)} placeholder="输入远端目录路径" />
        <button disabled={loading}>前往</button>
        <button type="button" aria-label="刷新目录" disabled={loading} onClick={() => void load(directory?.path ?? '')}><RefreshCw size={17} /></button>
      </form>
      <form className="files-direct" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void download(String(data.get('file'))); }}>
        <input name="file" aria-label="远端文件完整路径" placeholder="也可输入文件完整路径直接下载" required disabled={!!downloading} />
        <button disabled={!!downloading}><Download size={16} />下载</button>
      </form>
      {error && <p className="message" role="alert">{error}</p>}
      {downloading && <DownloadStatus progress={progress} filename={downloading} />}
      {(!downloading || loading) && <p className="files-status" role="status">{loading ? '正在读取目录…' : status || `${directory?.entries.length ?? 0} 个项目`}</p>}
      <div className="files-list" aria-busy={loading}>
        {directory?.entries.map(entry => <div className="files-row" key={entry.path}>
          <button className="files-name" disabled={loading || !entry.isDir} onClick={() => void load(entry.path)} title={entry.path}>
            {entry.isDir ? <Folder size={19} /> : <File size={19} />}<span>{entry.name}</span>
          </button>
          <span className="files-size">{entry.isDir ? '文件夹' : size(entry.size)}</span>
          <time className="files-date">{entry.modified ? new Date(entry.modified * 1000).toLocaleString() : ''}</time>
          {!entry.isDir && <button disabled={!!downloading} aria-label={`下载 ${entry.name}`} onClick={() => void download(entry.path)}><Download size={16} /><span>{downloading === entry.path ? '下载中…' : '下载'}</span></button>}
        </div>)}
        {!loading && directory?.entries.length === 0 && <p className="empty">此目录为空</p>}
      </div>
    </section>
  </main>;
}
