export interface TabDragBounds { left: number; right: number; top: number; bottom: number }

// Pointer capture keeps delivering movement when the cursor leaves the WebView.
// Trigger during movement; native HTML dragend coordinates are unreliable there.
export function createTabDrag(detach: () => void) {
  let gesture: { id: number; x: number; y: number; bounds: TabDragBounds } | null = null;
  let dragged = false;
  return {
    start(id: number, x: number, y: number, bounds: TabDragBounds) {
      gesture = { id, x, y, bounds }; dragged = false;
    },
    move(id: number, x: number, y: number) {
      if (!gesture || gesture.id !== id) return;
      if (Math.hypot(x - gesture.x, y - gesture.y) < 8) return;
      const { bounds } = gesture;
      if (x >= bounds.left - 24 && x <= bounds.right + 24 && y >= bounds.top - 24 && y <= bounds.bottom + 24) return;
      gesture = null;
      dragged = true;
      detach();
    },
    cancel() { gesture = null; },
    suppressClick() { return dragged; },
  };
}
