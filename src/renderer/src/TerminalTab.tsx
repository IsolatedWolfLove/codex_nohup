import { useRef, type ReactNode } from 'react';
import { createTabDrag } from './tab-drag';

export function TerminalTab({ children, active, enabled, onDetach }: { children: ReactNode; active: boolean; enabled: boolean; onDetach: () => void }) {
  const callback = useRef(onDetach); callback.current = onDetach;
  const drag = useRef<ReturnType<typeof createTabDrag> | null>(null);
  if (!drag.current) drag.current = createTabDrag(() => callback.current());
  return <div className={`terminal-tab ${active ? 'active' : ''}`}
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
  >{children}</div>;
}
