import { clampToViewport, el, makeDraggable, type Point } from './dom';
import { BUBBLE_DIAMETERS, type BubbleSize } from './layout';

export interface BubbleCallbacks {
  persist: (patch: { bubble?: Point; bubbleSize?: BubbleSize }) => void;
}

/**
 * Circular camera bubble. The camera itself runs in an extension-origin iframe so the page never
 * gets access to the stream, and it only exists while this tab is visible.
 */
export class CameraBubble {
  readonly root = el('div', 'bubble');
  private readonly lens = el('div', 'lens');
  private readonly sizeButtons = new Map<BubbleSize, HTMLButtonElement>();
  private iframe: HTMLIFrameElement | null = null;
  private cameraId: string | null = null;
  private size: BubbleSize = 'm';
  private position: Point | null = null;
  private readonly cleanupDrag: () => void;

  constructor(callbacks: BubbleCallbacks) {
    const grab = el('div', 'grab');
    const sizes = el('div', 'sizes');
    for (const size of ['s', 'm', 'l'] as const) {
      const button = el('button', undefined, size.toUpperCase());
      button.type = 'button';
      button.setAttribute('aria-label', `Camera size ${size.toUpperCase()}`);
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', () => {
        this.setSize(size);
        callbacks.persist({ bubbleSize: size, bubble: this.currentPosition() });
      });
      this.sizeButtons.set(size, button);
      sizes.append(button);
    }
    this.root.append(this.lens, grab, sizes);
    this.applySize();

    this.cleanupDrag = makeDraggable(grab, {
      getOrigin: () => this.currentPosition(),
      onStart: () => this.root.classList.add('dragging'),
      onMove: (point) => this.applyPosition(point),
      onEnd: (point, moved) => {
        this.root.classList.remove('dragging');
        if (moved) {
          this.position = this.clamp(point);
          callbacks.persist({ bubble: this.position });
        }
      },
    });
  }

  private get diameter(): number {
    return BUBBLE_DIAMETERS[this.size];
  }

  private clamp(point: Point): Point {
    return clampToViewport(point, this.diameter, this.diameter + 18, 16);
  }

  private currentPosition(): Point {
    return this.clamp(this.position ?? { x: 24, y: window.innerHeight - this.diameter - 40 });
  }

  private applyPosition(point: Point): void {
    const clamped = this.clamp(point);
    this.root.style.left = `${clamped.x}px`;
    this.root.style.top = `${clamped.y}px`;
  }

  private applySize(): void {
    this.root.style.width = `${this.diameter}px`;
    this.root.style.height = `${this.diameter}px`;
    this.sizeButtons.forEach((button, size) => button.classList.toggle('selected', size === this.size));
  }

  setLayout(position: Point | null, size: BubbleSize): void {
    this.position = position;
    this.setSize(size);
  }

  setSize(size: BubbleSize): void {
    this.size = size;
    this.applySize();
    this.applyPosition(this.currentPosition());
  }

  relayout(): void {
    this.applyPosition(this.currentPosition());
  }

  mount(cameraId: string | null): void {
    if (this.iframe && this.cameraId === cameraId) return;
    this.unmountCamera();
    this.cameraId = cameraId;
    const url = new URL(chrome.runtime.getURL('camera.html'));
    if (cameraId) url.searchParams.set('deviceId', cameraId);
    const iframe = el('iframe');
    iframe.src = url.toString();
    iframe.allow = 'camera; microphone';
    iframe.title = 'Spool camera';
    iframe.setAttribute('scrolling', 'no');
    this.iframe = iframe;
    this.lens.append(iframe);
    this.relayout();
    requestAnimationFrame(() => this.root.classList.toggle('visible', this.iframe !== null));
  }

  private unmountCamera(): void {
    this.iframe?.remove();
    this.iframe = null;
    this.cameraId = null;
  }

  unmount(): void {
    this.root.classList.remove('visible');
    this.unmountCamera();
  }

  get mounted(): boolean {
    return this.iframe !== null;
  }

  destroy(): void {
    this.cleanupDrag();
    this.unmount();
    this.root.remove();
  }
}
