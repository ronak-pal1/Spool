import { isExtensionMessage, notify, request, sendCommand, type RecorderCommand } from '@/lib/messages';
import { IDLE_STATE, readRecordingState, subscribeRecordingState, type RecordingPhase, type RecordingState } from '@/lib/state';
import { ControlBar, DRAW_COLORS } from './bar';
import { CameraBubble } from './bubble';
import { CountdownOverlay } from './countdown';
import { DrawLayer } from './draw';
import { readLayout, subscribeLayout, writeLayout, type OverlayLayout } from './layout';
import { overlayStyles } from './styles';

const HOST_TAG = 'spool-recorder-overlay';
const LOADED_FLAG = '__spoolOverlayLoaded';

const OVERLAY_PHASES: ReadonlySet<RecordingPhase> = new Set(['countdown', 'recording', 'paused', 'finalizing', 'error']);
const BAR_PHASES: ReadonlySet<RecordingPhase> = new Set(['recording', 'paused', 'finalizing', 'error']);
const BUBBLE_PHASES: ReadonlySet<RecordingPhase> = new Set(['countdown', 'recording', 'paused']);

function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

class Overlay {
  private readonly host = document.createElement(HOST_TAG);
  private readonly shadow: ShadowRoot;
  private readonly bar: ControlBar;
  private readonly bubble: CameraBubble;
  private readonly countdown: CountdownOverlay;
  private readonly draw: DrawLayer;
  private state: RecordingState = { ...IDLE_STATE };
  private layout: OverlayLayout = { bar: null, bubble: null, bubbleSize: 'm' };
  private tabId: number | null = null;
  private drawing = false;
  private color: string = DRAW_COLORS[0];
  private ticker: number | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor() {
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = overlayStyles;
    this.draw = new DrawLayer();
    this.bubble = new CameraBubble({ persist: (patch) => void writeLayout(patch) });
    this.countdown = new CountdownOverlay(() => this.command('discard'));
    this.bar = new ControlBar({
      command: (command) => this.command(command),
      toggleDraw: () => this.setDrawing(!this.drawing),
      setColor: (color) => {
        this.color = color;
        this.draw.setColor(color);
        this.render();
      },
      focusRecorder: () => notify({ type: 'spool:focus-recorder' }),
      persistPosition: (point) => void writeLayout({ bar: point }),
    });
    this.shadow.append(style, this.draw.canvas, this.bubble.root, this.bar.root, this.countdown.root);

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
  }

  async init(): Promise<void> {
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (isExtensionMessage(message) && message.type === 'spool:ping') {
        sendResponse({ ok: true, data: undefined });
      }
      return false;
    });
    this.unsubscribers.push(
      subscribeRecordingState((state) => {
        this.state = state;
        this.render();
      }),
      subscribeLayout((layout) => {
        this.layout = layout;
        this.applyLayout();
      }),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);

    const [state, layout, who] = await Promise.all([
      readRecordingState(),
      readLayout(),
      request<{ tabId: number | null }>({ type: 'spool:whoami' }).catch(() => ({ tabId: null })),
    ]);
    this.state = state;
    this.layout = layout;
    this.tabId = who.tabId;
    this.applyLayout();
    this.render();
  }

  private command(command: RecorderCommand): void {
    if (!extensionAlive()) return this.dispose();
    if (command === 'discard' || command === 'restart') this.setDrawing(false);
    sendCommand(command);
  }

  private setDrawing(drawing: boolean): void {
    this.drawing = drawing;
    this.draw.setEnabled(drawing);
    if (!drawing) this.draw.clear();
    this.render();
  }

  private applyLayout(): void {
    this.bar.setPosition(this.layout.bar);
    this.bubble.setLayout(this.layout.bubble, this.layout.bubbleSize);
  }

  private get relevant(): boolean {
    const { state } = this;
    if (!OVERLAY_PHASES.has(state.phase)) return false;
    if (this.tabId !== null && this.tabId === state.recorderTabId) return false;
    if (state.mode === 'tab') return this.tabId !== null && this.tabId === state.targetTabId;
    return true;
  }

  private render(): void {
    if (!extensionAlive()) return this.dispose();
    const { state } = this;
    const visible = document.visibilityState === 'visible';
    if (!this.relevant) {
      this.teardown();
      return;
    }
    if (!this.host.isConnected) {
      document.documentElement.append(this.host);
      this.applyLayout();
    }

    if (state.phase === 'countdown' && state.countdownEndsAt !== null) this.countdown.start(state.countdownEndsAt);
    else this.countdown.stop();

    const canDraw = state.phase === 'recording' || state.phase === 'paused';
    if (!canDraw && this.drawing) {
      this.drawing = false;
      this.draw.setEnabled(false);
      this.draw.clear();
    }

    if (BAR_PHASES.has(state.phase)) {
      this.bar.update(state, this.drawing, this.color);
      this.bar.show();
    } else {
      this.bar.hide();
    }

    if (state.cameraBubble && BUBBLE_PHASES.has(state.phase) && visible) this.bubble.mount(state.cameraId);
    else this.bubble.unmount();

    const ticking = state.phase === 'recording' && visible;
    if (ticking && this.ticker === null) this.ticker = window.setInterval(() => this.bar.tick(), 250);
    if (!ticking && this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private teardown(): void {
    this.countdown.stop();
    this.bar.hide();
    this.bubble.unmount();
    if (this.drawing) {
      this.drawing = false;
      this.draw.setEnabled(false);
    }
    this.draw.clear();
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
    this.host.remove();
  }

  private onVisibility(): void {
    this.render();
  }

  private onResize(): void {
    this.bar.relayout();
    this.bubble.relayout();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.host.isConnected) return;
    if (this.state.phase === 'countdown') {
      event.preventDefault();
      event.stopPropagation();
      this.command('discard');
    } else if (this.drawing) {
      event.preventDefault();
      event.stopPropagation();
      this.setDrawing(false);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    const { state } = this;
    if (state.mode !== 'tab' || state.phase !== 'recording' || !this.relevant) return;
    if (!event.isPrimary || event.button !== 0 || this.drawing) return;
    if (event.composedPath().includes(this.host)) return;
    if (!extensionAlive()) return this.dispose();
    notify({ type: 'spool:click', x: event.clientX / Math.max(1, window.innerWidth), y: event.clientY / Math.max(1, window.innerHeight) });
  }

  /** The extension was reloaded or removed; this orphaned script must leave the page clean. */
  private dispose(): void {
    this.teardown();
    this.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // chrome.* listeners throw once the extension context is gone.
      }
    });
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    this.bar.destroy();
    this.bubble.destroy();
    this.draw.destroy();
  }
}

const scope = globalThis as typeof globalThis & { [LOADED_FLAG]?: boolean };
if (!scope[LOADED_FLAG] && window.top === window) {
  scope[LOADED_FLAG] = true;
  // A previous extension version may have left its overlay behind before being reloaded.
  document.querySelectorAll(HOST_TAG).forEach((node) => node.remove());
  void new Overlay().init();
}
