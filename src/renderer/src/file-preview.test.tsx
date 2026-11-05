import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview } from './FilePreview';
import { canPreview, readDownloadTask, saveDownloadTask } from './file-preview';

afterEach(() => vi.unstubAllGlobals());
describe('file preview and transfer recovery', () => {
  it('renders GFM without executing HTML or loading remote images', () => {
    const html = renderToStaticMarkup(<MarkdownPreview text={'# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![image](https://example.com/tracker.png)\n\n[link](javascript:alert(1))'} />);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });
  it('limits preview formats to the supported passive types', () => {
    for (const name of ['a.MD', 'a.txt', 'a.PDF', 'a.jpeg', 'a.webp']) expect(canPreview(name)).toBe(true);
    for (const name of ['a.html', 'a.svg', 'a.exe', 'a.pdf.exe']) expect(canPreview(name)).toBe(false);
  });
  it('keeps stable transfer IDs across reopen, isolating servers and clearing discarded tasks', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
    const task = { id: 'stable-request', path: '/work/large.bin', folder: false };
    saveDownloadTask('one', task);
    expect(readDownloadTask('one')).toEqual(task);
    expect(readDownloadTask('two')).toBeNull();
    saveDownloadTask('one', null);
    expect(readDownloadTask('one')).toBeNull();
    map.set('nohop.download.one', '{invalid');
    expect(readDownloadTask('one')).toBeNull();
  });
});
