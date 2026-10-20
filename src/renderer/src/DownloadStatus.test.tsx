import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DownloadStatus } from './DownloadStatus';

describe('download progress display', () => {
  it('shows actual percentage, transferred size and speed', () => {
    const html = renderToStaticMarkup(<DownloadStatus filename="/tmp/report.bin" progress={{ requestId: 'a', stage: 'downloading', transferred: 1024, total: 4096, bytesPerSecond: 512 }} />);
    expect(html).toContain('25.0%');
    expect(html).toContain('1.0 KiB / 4.0 KiB');
    expect(html).toContain('512 B/s');
    expect(html).toContain('value="25"');
  });
  it('distinguishes Android saving from network download', () => {
    const html = renderToStaticMarkup(<DownloadStatus filename="report.bin" progress={{ requestId: 'a', stage: 'saving', transferred: 2048, total: 4096 }} />);
    expect(html).toContain('正在保存到所选位置');
    expect(html).toContain('50.0%');
  });
  it('uses an indeterminate bar before the remote size is known', () => {
    const html = renderToStaticMarkup(<DownloadStatus filename="report.bin" progress={null} />);
    expect(html).toContain('准备下载');
    expect(html).not.toContain('value=');
  });
  it('handles empty files without NaN or an infinite percentage', () => {
    const html = renderToStaticMarkup(<DownloadStatus filename="empty" progress={{ requestId: 'a', stage: 'downloading', transferred: 0, total: 0 }} />);
    expect(html).toContain('100.0%');
    expect(html).not.toContain('NaN');
  });
});
