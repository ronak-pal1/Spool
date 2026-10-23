export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function iconButton(className: string, icon: string, tip: string): HTMLButtonElement {
  const button = el('button', className, icon);
  button.type = 'button';
  button.dataset.tip = tip;
  button.setAttribute('aria-label', tip);
  return button;
}

export interface Point {
  x: number;
  y: number;
}

export function clampToViewport(point: Point, width: number, height: number, margin = 8): Point {
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, point.x)),
    y: Math.min(maxY, Math.max(margin, point.y)),
  };
}

interface DragOptions {
  getOrigin: () => Point;
  onMove: (point: Point) => void;
  onStart?: () => void;
  onEnd?: (point: Point, moved: boolean) => void;
}

/** Pointer-captured dragging that distinguishes a click (no movement) from a drag. */
export function makeDraggable(handle: HTMLElement, options: DragOptions): () => void {
  let start: Point | null = null;
  let origin: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  let moved = false;
  let pointerId: number | null = null;

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    start = { x: event.clientX, y: event.clientY };
    origin = options.getOrigin();
    last = origin;
    moved = false;
    pointerId = event.pointerId;
    handle.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!start || event.pointerId !== pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    if (!moved) options.onStart?.();
    moved = true;
    last = { x: origin.x + dx, y: origin.y + dy };
    options.onMove(last);
  };
  const up = (event: PointerEvent) => {
    if (!start || event.pointerId !== pointerId) return;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    start = null;
    pointerId = null;
    options.onEnd?.(last, moved);
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
  };
}
