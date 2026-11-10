import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App, TerminalView } from './App';
import { useEffect, useState } from 'react';
import type { OpenTerminal } from './use-workspace';
import { installNativeRuntime, closeNativeWindow } from './native-runtime';

type DetachedTerminal = OpenTerminal & { predictionEnabled?: boolean };
function Detached({ initial }: { initial: DetachedTerminal }) {
 const [item, setItem] = useState(initial);
 useEffect(() => window.runtime.EventsOn('terminal:updated', (payload: string) => { const next = JSON.parse(payload); if (next.key === initial.key) { if (next.closed) void closeNativeWindow(); else setItem(next); } }), [initial.key]);
 return <div className="detached-terminal"><div className="detached-heading"><strong>{item.name}</strong><button onClick={() => void closeNativeWindow()}>放回主窗口</button></div>{item.id ? <TerminalView item={item} predictionEnabled={item.predictionEnabled === true} active focused onFocus={() => {}} /> : <div className="terminal-empty">正在恢复连接…</div>}</div>;
}

async function start() {
  if (import.meta.env.MODE === 'android') {
    const { installAndroidRuntime } = await import('./android-runtime');
    installAndroidRuntime();
  } else { installNativeRuntime(); }
  const detachedPayload = new URLSearchParams(location.search).get('terminal');
  const detached = detachedPayload ? JSON.parse(detachedPayload) as DetachedTerminal : null;
  const resize = () => document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
  resize();
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('resize', resize);
  const native = window.runtime as unknown as { WindowMinimise?: () => void; WindowToggleMaximise?: () => void; Quit?: () => void };
  const framed = import.meta.env.MODE !== 'android' && !!native?.WindowMinimise;
  if (framed) document.body.classList.add('custom-frame');
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><>{framed && <div className="window-controls" onDoubleClick={() => native.WindowToggleMaximise?.()}><span>Nohop Codex</span><button aria-label="最小化" onClick={() => native.WindowMinimise?.()}>—</button><button aria-label="最大化或还原" onClick={() => native.WindowToggleMaximise?.()}>□</button><button aria-label="关闭窗口" onClick={() => native.Quit?.()}>×</button></div>}{detached ? <Detached initial={detached} /> : <App />}</></React.StrictMode>);
}
void start();
