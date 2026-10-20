import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Network, Plus, RefreshCw, Square } from 'lucide-react';
import { desktop } from './desktop-api';
import type { PortForward, PortForwardInput } from '../../shared/contracts';

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function address(host: string, port: number) { return `${host.includes(':') ? `[${host}]` : host}:${port}`; }

export function PortForwards({ connectionId, serverName, onBack }: { connectionId: string; serverName: string; onBack: () => void }) {
  const [input, setInput] = useState<PortForwardInput>({ direction: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80 });
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const operation = useRef(false);

  async function load() {
    const request = ++generation.current;
    try {
      const result = await desktop.listPortForwards(connectionId);
      if (mounted.current && request === generation.current) { setForwards(result); setLoadError(''); }
    } catch (error) {
      if (mounted.current && request === generation.current) setLoadError(message(error));
    } finally { if (mounted.current && request === generation.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => { if (!operation.current) void load(); }, 3000);
    return () => { mounted.current = false; generation.current++; window.clearInterval(timer); };
  }, [connectionId]);

  async function change(action: () => Promise<unknown>, success: string) {
    if (operation.current) return;
    operation.current = true;
    generation.current++;
    setBusy(true); setError(''); setStatus('');
    try {
      await action();
      if (mounted.current) { setStatus(success); await load(); }
    } catch (error) { if (mounted.current) setError(message(error)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }

  const local = input.direction === 'local';
  return <main className="files-page">
    <header className="files-header">
      <button onClick={onBack}><ArrowLeft size={17} />返回终端</button>
      <div><h1>端口转发</h1><small>{serverName}</small></div>
    </header>
    <section className="files-content forwards-content" aria-label="SSH 端口转发">
      <form className="forward-form" onSubmit={event => { event.preventDefault(); void change(() => desktop.startPortForward(connectionId, input), '转发已启动'); }}>
        <h2><Network size={19} />新建 TCP 转发</h2>
        <label>转发方式<select value={input.direction} disabled={busy} onChange={event => setInput({ ...input, direction: event.target.value as PortForwardInput['direction'] })}>
          <option value="local">本地转发（本机 → 服务器网络）</option>
          <option value="remote">远程转发（服务器 → 本机网络）</option>
        </select></label>
        <p className="files-status">{local ? '在本机监听，通过 SSH 访问服务器能够连接的目标服务。' : '在服务器监听，通过 SSH 访问本机能够连接的目标服务。'}</p>
        <div className="forward-endpoints">
          <fieldset disabled={busy}><legend>{local ? '本机监听' : '服务器监听'}</legend>
            <label>监听地址<input required value={input.listenHost} onChange={event => setInput({ ...input, listenHost: event.target.value })} placeholder="127.0.0.1" /></label>
            <label>监听端口<input required type="number" min="1" max="65535" step="1" value={input.listenPort || ''} onChange={event => setInput({ ...input, listenPort: Number(event.target.value) })} /></label>
          </fieldset>
          <ArrowRight className="forward-arrow" size={22} aria-hidden="true" />
          <fieldset disabled={busy}><legend>{local ? '目标（从服务器访问）' : '目标（从本机访问）'}</legend>
            <label>目标主机<input required value={input.targetHost} onChange={event => setInput({ ...input, targetHost: event.target.value })} placeholder="127.0.0.1" /></label>
            <label>目标端口<input required type="number" min="1" max="65535" step="1" value={input.targetPort || ''} onChange={event => setInput({ ...input, targetPort: Number(event.target.value) })} /></label>
          </fieldset>
        </div>
        <p className="files-status">默认仅在监听端的本机开放。远程监听地址是否生效取决于服务器的 GatewayPorts 设置。返回终端后转发继续运行，SSH 断开后自动停止。</p>
        <button className="primary" disabled={busy || loading}><Plus size={17} />{busy ? '正在处理…' : '启动转发'}</button>
      </form>
      {(error || loadError) && <p className="message" role="alert">{error || loadError}</p>}
      <div className="forward-heading"><h2>运行中的转发 <small>（{forwards.length}）</small></h2><button aria-label="刷新转发列表" disabled={busy || loading} onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16} />刷新</button></div>
      <p className="files-status" role="status">{loading ? '正在读取转发列表…' : status || '监听成功后，访问监听地址即可使用转发。'}</p>
      <div className="files-list" aria-busy={loading}>
        {forwards.map(forward => <div className="forward-row" key={forward.id}>
          <div><span className="forward-kind">{forward.direction === 'local' ? '本地转发' : '远程转发'}</span><small>监听中</small></div>
          <div className="forward-route"><code>{address(forward.listenHost, forward.listenPort)}</code><ArrowRight size={16} /><code>{address(forward.targetHost, forward.targetPort)}</code>
            <small>{forward.direction === 'local' ? '本机 → 服务器网络' : '服务器 → 本机网络'}</small>
            {forward.lastError && <p className="message" role="alert">最近一次失败：{forward.lastError}</p>}
          </div>
          <button disabled={busy} aria-label={`停止 ${address(forward.listenHost, forward.listenPort)} 转发`} onClick={() => void change(() => desktop.stopPortForward(connectionId, forward.id), '转发已停止')}><Square size={14} />停止</button>
        </div>)}
        {!loading && forwards.length === 0 && <p className="empty">还没有运行中的转发，请在上方创建。</p>}
      </div>
    </section>
  </main>;
}
