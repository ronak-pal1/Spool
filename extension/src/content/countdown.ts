import { el } from './dom';

const RADIUS = 82;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class CountdownOverlay {
  readonly root = el('div', 'countdown');
  private num = el('span', 'num');
  private readonly arc: SVGCircleElement;
  private endsAt = 0;
  private total = 3000;
  private frame: number | null = null;
  private shown = -1;
  private wanted = false;

  constructor(onCancel: () => void) {
    const ring = el('div', 'ring');
    ring.innerHTML = `<svg viewBox="0 0 170 170"><circle class="track" cx="85" cy="85" r="${RADIUS}"/><circle class="arc" cx="85" cy="85" r="${RADIUS}" stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="0"/></svg>`;
    this.arc = ring.querySelector('.arc') as SVGCircleElement;
    ring.append(this.num);
    const hint = el('span', 'hint', 'Recording starts in a moment · <kbd>Esc</kbd> to cancel');
    const cancel = el('button', 'cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', onCancel);
    const stack = el('div', 'stack');
    stack.append(ring, hint, cancel);
    this.root.append(stack);
  }

  start(endsAt: number): void {
    if (this.endsAt === endsAt && this.frame !== null) return;
    this.endsAt = endsAt;
    this.total = Math.max(1000, endsAt - Date.now());
    this.shown = -1;
    this.wanted = true;
    // rAF is deferred in background tabs, so the callback re-checks intent before revealing.
    requestAnimationFrame(() => this.root.classList.toggle('visible', this.wanted));
    this.loop();
  }

  private loop(): void {
    const remaining = Math.max(0, this.endsAt - Date.now());
    const seconds = Math.max(1, Math.ceil(remaining / 1000));
    if (seconds !== this.shown) {
      this.shown = seconds;
      // Re-inserting the node restarts the CSS pop animation for each number.
      const fresh = this.num.cloneNode() as HTMLSpanElement;
      fresh.textContent = String(seconds);
      this.num.replaceWith(fresh);
      this.num = fresh;
    }
    this.arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - remaining / this.total));
    this.frame = remaining > 0 ? requestAnimationFrame(() => this.loop()) : null;
  }

  stop(): void {
    this.wanted = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.endsAt = 0;
    this.root.classList.remove('visible');
  }
}
