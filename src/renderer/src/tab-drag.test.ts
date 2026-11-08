import { describe, expect, it, vi } from 'vitest';
import { createTabDrag } from './tab-drag';
const bounds = { left: 300, right: 1200, top: 32, bottom: 75 };
describe('terminal tab pointer drag', () => {
  it('detaches during movement outside the bar without waiting for dragend', () => {
    const detach = vi.fn(); const drag = createTabDrag(detach);
    drag.start(1, 400, 50, bounds);
    drag.move(1, 400, 110);
    drag.move(1, 400, 200);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(drag.suppressClick()).toBe(true);
  });
  it('detaches above and to either side of the window', () => {
    for (const [x, y] of [[400, -5], [-10, 50], [1250, 50]]) {
      const detach = vi.fn(); const drag = createTabDrag(detach);
      drag.start(1, 400, 50, bounds); drag.move(1, x, y);
      expect(detach).toHaveBeenCalledOnce();
    }
  });
  it('preserves clicks and movement within the tab strip', () => {
    const detach = vi.fn(); const drag = createTabDrag(detach);
    drag.start(1, 400, 50, bounds); drag.move(1, 700, 60); drag.cancel();
    expect(detach).not.toHaveBeenCalled(); expect(drag.suppressClick()).toBe(false);
  });
  it('ignores other pointers and cancelled gestures', () => {
    const detach = vi.fn(); const drag = createTabDrag(detach);
    drag.start(1, 400, 50, bounds); drag.move(2, 400, 200); drag.cancel(); drag.move(1, 400, 200);
    expect(detach).not.toHaveBeenCalled();
  });
  it('allows a fresh click after a completed drag', () => {
    const drag = createTabDrag(vi.fn()); drag.start(1, 400, 50, bounds); drag.move(1, 400, 150);
    drag.start(2, 400, 50, bounds); expect(drag.suppressClick()).toBe(false);
  });
});
