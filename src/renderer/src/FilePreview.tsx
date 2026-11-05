import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { FilePreview as Preview } from '../../shared/contracts';
import { desktop, decodeTerminalData } from './desktop-api';

function PdfPreview({ data }: { data: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    void import('pdfjs-dist/legacy/build/pdf.mjs').then(async ({ getDocument, GlobalWorkerOptions }) => {
      if (disposed) return;
      GlobalWorkerOptions.workerSrc = workerUrl;
      task = getDocument({ data: decodeTerminalData(data),
        cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href, cMapPacked: true,
        standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href,
        wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href,
      });
      const result = await task.promise;
      if (!disposed) { setPdf(result); setPage(1); }
    }).catch(error => { if (!disposed) { setError(String(error)); setLoading(false); } });
    return () => { disposed = true; void task?.destroy(); };
  }, [data]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(120, entries[0].contentRect.width - 24)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let disposed = false;
    let render: RenderTask | undefined;
    const element = canvas.current;
    setLoading(true); setError('');
    void pdf.getPage(page).then(async result => {
      if (disposed) return;
      const original = result.getViewport({ scale: 1 });
      const scale = Math.min(2, width / original.width) * zoom;
      const viewport = result.getViewport({ scale });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      element.width = Math.ceil(viewport.width * ratio);
      element.height = Math.ceil(viewport.height * ratio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      render = result.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (!disposed) setLoading(false);
    }).catch(error => { if (!disposed) { setError(String(error)); setLoading(false); } });
    return () => { disposed = true; render?.cancel(); };
  }, [pdf, page, zoom, width]);
  return <div className="pdf-preview" ref={container}>
    <div className="preview-toolbar"><button disabled={page <= 1 || !pdf} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {pdf?.numPages ?? '…'}</span><button disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(p => p + 1)}>下一页</button><button aria-label="缩小 PDF" disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大 PDF" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.25))}>＋</button></div>
    {loading && <p role="status">正在渲染 PDF…</p>}{error && <p role="alert" className="message">{error}</p>}
    <div className="pdf-pages"><canvas key={`${page}:${zoom}:${width}`} ref={canvas} aria-label={`PDF 第 ${page} 页`} /></div>
  </div>;
}

export function MarkdownPreview({ text }: { text: string }) {
  return <article className="markdown-preview"><Markdown remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => <span className="preview-image-placeholder">[图片：{alt || '外部图片未加载'}]</span>,
    a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
  }}>{text}</Markdown></article>;
}

export function FilePreview({ connectionId, path, onClose }: { connectionId: string; path: string; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  useEffect(() => {
    let disposed = false;
    const request = crypto.randomUUID();
    setPreview(null); setError('');
    void desktop.previewFile(connectionId, path, request).then(result => {
      if (!disposed) setPreview(result);
    }).catch(error => { if (!disposed) setError(error instanceof Error ? error.message : String(error)); });
    return () => { disposed = true; void desktop.cancelDownload(request).catch(() => {}); };
  }, [connectionId, path]);
  useEffect(() => {
    if (preview?.kind !== 'image') { setImage(''); return; }
    const bytes = decodeTerminalData(preview.data);
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: preview.mime }));
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <div className="modal-backdrop file-preview-backdrop"><section className="file-preview-modal" role="dialog" aria-modal="true" aria-label="文件预览">
    <header><div><h2>{preview?.name ?? path.split('/').pop()}</h2><small>文件预览</small></div><button autoFocus aria-label="关闭预览" onClick={onClose}><X size={20} /></button></header>
    <div className="file-preview-body">
      {!preview && !error && <p role="status">正在读取文件…</p>}{error && <p className="message" role="alert">{error}</p>}
      {preview?.truncated && <p className="preview-notice">文件较大，仅显示前 1 MiB；下载可查看完整内容。</p>}
      {preview?.kind === 'text' && <pre className="text-preview">{preview.data}</pre>}
      {preview?.kind === 'markdown' && <MarkdownPreview text={preview.data} />}
      {preview?.kind === 'image' && image && <img className="image-preview" src={image} alt={preview.name} onError={() => setError('图片无法解码，请下载后查看')} />}
      {preview?.kind === 'pdf' && <PdfPreview data={preview.data} />}
    </div>
  </section></div>;
}
