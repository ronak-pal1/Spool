import { formatTimestamp } from '@spool/shared';
import type { RecorderCommand } from '@/lib/messages';
import { elapsedMs, type RecordingState } from '@/lib/state';
import { clampToViewport, el, iconButton, makeDraggable, type Point } from './dom';
import { icons } from './icons';

export const DRAW_COLORS = ['#00FA9A', '#FF5C6C', '#FFD54A', '#5CA8FF', '#FFFFFF'] as const;

export interface BarCallbacks {
  command: (command: RecorderCommand) => void;
  toggleDraw: () => void;
  setColor: (color: string) => void;
  focusRecorder: () => void;
  persistPosition: (point: Point) => void;
}

type Confirm = 'restart' | 'discard' | null;

export class ControlBar {
  readonly root = el('div', 'bar');
  private readonly live = el('div');
  private readonly status = el('div', 'status');
  private readonly time = el('span', 'time', '00:00');
  private readonly limit = el('span', 'limit');
  private readonly progressFill = el('i');
  private readonly pauseBtn = iconButton('icon-btn', icons.pause, 'Pause');
  private readonly micBtn = iconButton('icon-btn', icons.mic, 'Mute microphone');
  private readonly drawBtn = iconButton('icon-btn', icons.pencil, 'Draw on screen');
  private readonly restartBtn = iconButton('icon-btn', icons.restart, 'Restart');
  private readonly discardBtn = iconButton('icon-btn danger', icons.trash, 'Discard');
  private readonly stopBtn = el('button', 'stop-btn', `${icons.stop}<span>Stop</span>`);
  private readonly confirm = el('div', 'popover');
  private readonly confirmMsg = el('span', 'msg');
  private readonly confirmBtn = el('button', 'confirm');
  private readonly palette = el('div', 'popover');
  private readonly swatches: HTMLButtonElement[] = [];

  private position: Point | null = null;
  private pendingConfirm: Confirm = null;
  private confirmTimer: number | null = null;
  private state: RecordingState | null = null;
  private mode: 'live' | 'status' = 'live';
  private wanted = false;
  private readonly cleanupDrag: () => void;

  constructor(private readonly callbacks: BarCallbacks) {
    this.live.style.display = 'contents';
    const grip = el('button', 'grip', icons.grip);
    grip.setAttribute('aria-label', 'Move controls');
    const clock = el('div', 'clock');
    const stack = el('div');
    stack.style.display = 'flex';
    stack.style.flexDirection = 'column';
    stack.style.lineHeight = '1.15';
    stack.append(this.time, this.limit);
    clock.append(el('span', 'dot'), stack);

    const progress = el('div', 'progress');
    progress.append(this.progressFill);

    this.stopBtn.type = 'button';
    this.stopBtn.setAttribute('aria-label', 'Stop and share');

    const cancel = el('button', 'ghost', 'Cancel');
    cancel.type = 'button';
    this.confirmBtn.type = 'button';
    this.confirm.append(this.confirmMsg, cancel, this.confirmBtn);

    for (const color of DRAW_COLORS) {
      const swatch = el('button', 'swatch');
      swatch.type = 'button';
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `Pen color ${color}`);
      swatch.addEventListener('click', () => callbacks.setColor(color));
      this.swatches.push(swatch);
    }
    const closeDraw = el('button', 'ghost', 'Done');
    closeDraw.type = 'button';
    closeDraw.addEventListener('click', () => callbacks.toggleDraw());
    this.palette.append(...this.swatches, closeDraw);

    this.live.append(
      clock,
      el('span', 'divider'),
      this.pauseBtn,
      this.micBtn,
      this.drawBtn,
      this.restartBtn,
      this.discardBtn,
      this.stopBtn,
    );
    this.root.append(grip, this.live, this.status, progress, this.confirm, this.palette);
    this.status.style.display = 'none';

    this.pauseBtn.addEventListener('click', () => {
      this.closeConfirm();
      callbacks.command('toggle-pause');
    });
    this.micBtn.addEventListener('click', () => {
      this.closeConfirm();
      callbacks.command('toggle-mic');
    });
    this.drawBtn.addEventListener('click', () => {
      this.closeConfirm();
      callbacks.toggleDraw();
    });
    this.restartBtn.addEventListener('click', () => this.openConfirm('restart'));
    this.discardBtn.addEventListener('click', () => this.openConfirm('discard'));
    this.stopBtn.addEventListener('click', () => {
      this.closeConfirm();
      callbacks.command('stop');
    });
    cancel.addEventListener('click', () => this.closeConfirm());
    this.confirmBtn.addEventListener('click', () => {
      const action = this.pendingConfirm;
      this.closeConfirm();
      if (action) callbacks.command(action);
    });

    this.cleanupDrag = makeDraggable(grip, {
      getOrigin: () => this.currentPosition(),
      onStart: () => this.root.classList.add('dragging'),
      onMove: (point) => this.applyPosition(point),
      onEnd: (point, moved) => {
        this.root.classList.remove('dragging');
        if (moved) {
          this.position = this.clamp(point);
          callbacks.persistPosition(this.position);
        }
      },
    });
  }

  private openConfirm(action: Exclude<Confirm, null>): void {
    this.pendingConfirm = action;
    this.confirmMsg.textContent = action === 'restart' ? 'Start over? This take is deleted.' : 'Discard this recording?';
    this.confirmBtn.textContent = action === 'restart' ? 'Restart' : 'Discard';
    this.confirmBtn.className = action === 'restart' ? 'confirm neutral' : 'confirm';
    this.confirm.classList.add('open');
    this.palette.classList.remove('open');
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.confirmTimer = window.setTimeout(() => this.closeConfirm(), 6000);
  }

  private closeConfirm(): void {
    this.pendingConfirm = null;
    this.confirm.classList.remove('open');
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
  }

  private clamp(point: Point): Point {
    return clampToViewport(point, this.root.offsetWidth || 420, this.root.offsetHeight || 52, 12);
  }

  private defaultPosition(): Point {
    const width = this.root.offsetWidth || 420;
    return { x: (window.innerWidth - width) / 2, y: window.innerHeight - 52 - 28 };
  }

  private currentPosition(): Point {
    return this.clamp(this.position ?? this.defaultPosition());
  }

  private applyPosition(point: Point): void {
    const clamped = this.clamp(point);
    this.root.style.left = `${clamped.x}px`;
    this.root.style.top = `${clamped.y}px`;
    this.root.classList.toggle('flip', clamped.y < 90);
  }

  setPosition(point: Point | null): void {
    this.position = point;
    this.applyPosition(this.currentPosition());
  }

  relayout(): void {
    this.applyPosition(this.currentPosition());
  }

  show(): void {
    if (!this.root.isConnected) return;
    this.wanted = true;
    this.relayout();
    requestAnimationFrame(() => this.root.classList.toggle('visible', this.wanted));
  }

  hide(): void {
    this.wanted = false;
    this.root.classList.remove('visible');
    this.closeConfirm();
  }

  update(state: RecordingState, drawing: boolean, color: string): void {
    this.state = state;
    const nextMode = state.phase === 'finalizing' || state.phase === 'error' ? 'status' : 'live';
    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.live.style.display = nextMode === 'live' ? 'contents' : 'none';
      this.status.style.display = nextMode === 'status' ? 'flex' : 'none';
      this.closeConfirm();
    }

    if (nextMode === 'status') {
      this.palette.classList.remove('open');
      this.renderStatus(state);
    } else {
      const paused = state.phase === 'paused';
      this.root.classList.toggle('paused', paused);
      this.pauseBtn.innerHTML = paused ? icons.play : icons.pause;
      this.pauseBtn.dataset.tip = paused ? 'Resume' : 'Pause';
      this.pauseBtn.setAttribute('aria-label', this.pauseBtn.dataset.tip);

      const micMuted = !state.micEnabled || state.micMuted;
      this.micBtn.innerHTML = micMuted ? icons.micOff : icons.mic;
      this.micBtn.classList.toggle('muted', state.micEnabled && state.micMuted);
      this.micBtn.disabled = !state.micEnabled;
      this.micBtn.dataset.tip = !state.micEnabled ? 'Microphone is off' : state.micMuted ? 'Unmute microphone' : 'Mute microphone';
      this.micBtn.setAttribute('aria-label', this.micBtn.dataset.tip);

      this.drawBtn.classList.toggle('active', drawing);
      this.palette.classList.toggle('open', drawing && this.pendingConfirm === null);
      this.swatches.forEach((swatch, index) => swatch.classList.toggle('selected', DRAW_COLORS[index] === color));
      this.limit.textContent = `/ ${formatTimestamp(state.maxSeconds)}`;
    }
    this.tick();
    this.relayout();
  }

  private renderStatus(state: RecordingState): void {
    this.status.replaceChildren();
    if (state.phase === 'finalizing') {
      const spin = el('span', 'spin', icons.spinner);
      const upload = state.upload;
      const pct = upload && upload.queuedBytes > 0 ? Math.min(100, Math.round((upload.uploadedBytes / upload.queuedBytes) * 100)) : null;
      const label = el('span', undefined, 'Finishing upload');
      this.status.append(spin, label);
      if (pct !== null) this.status.append(el('span', 'pct', `${pct}%`));
      return;
    }
    const icon = el('span', 'err', icons.alert);
    const label = el('span', undefined, 'Upload needs attention');
    const open = el('button', 'link-btn', 'Open recorder');
    open.type = 'button';
    open.addEventListener('click', () => this.callbacks.focusRecorder());
    this.status.append(icon, label, open);
  }

  /** Called frequently; only touches text and a transform. */
  tick(): void {
    const state = this.state;
    if (!state || this.mode !== 'live') return;
    const elapsed = elapsedMs(state) / 1000;
    const remaining = state.maxSeconds - elapsed;
    this.time.textContent = formatTimestamp(elapsed);
    this.progressFill.style.transform = `scaleX(${Math.min(1, elapsed / Math.max(1, state.maxSeconds))})`;
    this.root.classList.toggle('warn', remaining <= 60 && remaining > 15);
    this.root.classList.toggle('critical', remaining <= 15);
  }

  destroy(): void {
    this.cleanupDrag();
    if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
    this.root.remove();
  }
}
