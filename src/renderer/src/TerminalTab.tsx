import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createTabDrag } from './tab-drag';

export function TerminalTab({ children, active, enabled, onDetach }: { children: ReactNode; active: boolean; enabled: boolean; onDetach: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); tabRef.current?.querySelector<HTMLButtonElement>('.tab-select')?.focus(); }
    };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  const callback = useRef(onDetach); callback.current = onDetach;
  const drag = useRef<ReturnType<typeof createTabDrag> | null>(null);
  if (!drag.current) drag.current = createTabDrag(() => callback.current());
  return <><div ref={tabRef} onContextMenu={event => {
    if (import.meta.env.MODE === 'android') return;
    event.preventDefault(); event.stopPropagation();
    drag.current!.cancel();
    setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)) });
  }} className={`terminal-tab ${active ? 'active' : ''}`}
    onPointerDown={event => {
      if (!enabled || event.button !== 0 || (event.target as HTMLElement).closest('.tab-action')) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current!.start(event.pointerId, event.clientX, event.clientY, bounds);
      event.currentTarget.querySelector('.tab-select')?.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => drag.current!.move(event.pointerId, event.clientX, event.clientY)}
    onPointerUp={event => {
      drag.current!.move(event.pointerId, event.clientX, event.clientY);
      drag.current!.cancel();
      const target = event.currentTarget.querySelector('.tab-select');
      if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => drag.current!.cancel()}
    onLostPointerCapture={() => drag.current!.cancel()}
    onClickCapture={event => { if (drag.current!.suppressClick() && !(event.target as HTMLElement).closest('.tab-action')) { event.preventDefault(); event.stopPropagation(); } }}
  >{children}</div>{menu && createPortal(<div ref={menuRef} className="tab-context-menu" role="menu" aria-label="标签操作" style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()}>
    <button type="button" role="menuitem" disabled={!enabled} onClick={() => { setMenu(null); onDetach(); }}>↗ 脱出为独立窗口</button>
  </div>, document.body)}</>;
}
