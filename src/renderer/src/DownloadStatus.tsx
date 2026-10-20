import type { DownloadProgress } from '../../shared/contracts';

function bytes(value: number) {
  if (value < 1024) return `${Math.floor(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

export function DownloadStatus({ progress, filename }: { progress: DownloadProgress | null; filename: string }) {
  const choosing = progress?.stage === 'choosing';
  const transferred = progress?.transferred ?? 0;
  const total = progress?.total;
  const percent = total === undefined ? undefined : total === 0 ? 100 : Math.min(100, Math.max(0, transferred / total * 100));
  const label = !progress ? '准备下载' : choosing ? '下载完成，请选择保存位置' : progress.stage === 'saving' ? '正在保存到所选位置' : '正在下载';
  return <section className="download-status" aria-label="下载进度">
    <div className="download-heading"><strong>{label}</strong>{percent !== undefined && <span>{percent.toFixed(1)}%</span>}</div>
    <p className="download-filename" title={filename}>{filename}</p>
    <progress aria-label={label} max={100} value={percent} />
    {progress && <div className="download-details"><span>{bytes(transferred)}{total !== undefined && ` / ${bytes(total)}`}</span><span>{!choosing && progress.bytesPerSecond !== undefined ? `${bytes(progress.bytesPerSecond)}/s` : ''}</span></div>}
  </section>;
}
