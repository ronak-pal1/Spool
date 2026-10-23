import { el } from './dom';

interface Stroke {
  color: string;
  points: { x: number; y: number }[];
  endedAt: number | null;
}

const HOLD_MS = 2200;
const FADE_MS = 650;

/** Full-viewport annotation layer whose strokes fade out shortly after the pen lifts. */
export class DrawLayer {
  readonly canvas = el('canvas', 'draw');
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private active: Stroke | null = null;
  private enabled = false;
  private color = '#00FA9A';
  private frame: number | null = null;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();

    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.button !== 0) return;
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.active = { color: this.color, points: [{ x: event.clientX, y: event.clientY }], endedAt: null };
      this.strokes.push(this.active);
      this.schedule();
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.active) return;
      const coalesced = event.getCoalescedEvents?.() ?? [];
      const samples = coalesced.length > 0 ? coalesced : [event];
      for (const sample of samples) this.active.points.push({ x: sample.clientX, y: sample.clientY });
      this.schedule();
    });
    const end = (event: PointerEvent) => {
      if (!this.active) return;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.active.endedAt = performance.now();
      this.active = null;
      this.schedule();
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.classList.toggle('enabled', enabled);
  }

  setColor(color: string): void {
    this.color = color;
  }

  clear(): void {
    this.strokes = [];
    this.active = null;
    this.paint();
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * ratio);
    this.canvas.height = Math.round(window.innerHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paint();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  private paint(): void {
    const now = performance.now();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.strokes = this.strokes.filter((stroke) => stroke.endedAt === null || now - stroke.endedAt < HOLD_MS + FADE_MS);
    for (const stroke of this.strokes) {
      const age = stroke.endedAt === null ? 0 : now - stroke.endedAt;
      const alpha = age <= HOLD_MS ? 1 : 1 - (age - HOLD_MS) / FADE_MS;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      const [first, ...rest] = stroke.points;
      if (first) {
        ctx.moveTo(first.x, first.y);
        if (rest.length === 0) ctx.lineTo(first.x + 0.01, first.y + 0.01);
        for (let i = 0; i < rest.length; i++) {
          const point = rest[i] as { x: number; y: number };
          const next = rest[i + 1];
          if (next) ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
          else ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    if (this.strokes.length > 0) this.schedule();
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }
}
