export type CaptureMode = 'screen' | 'tab' | 'camera';

export type RecordingPhase = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'finalizing' | 'error';

export interface UploadSnapshot {
  uploadedBytes: number;
  queuedBytes: number;
}

/**
 * The single source of truth for an in-flight recording. It lives in `chrome.storage.session`
 * so the popup, the service worker and every content script observe the same state.
 * Only the background (before the recorder exists) and the recorder page write to it.
 */
export interface RecordingState {
  phase: RecordingPhase;
  mode: CaptureMode;
  recorderTabId: number | null;
  /** Tab being captured (tab mode) or the tab the user started from (screen/camera mode). */
  targetTabId: number | null;
  /** Wall-clock ms at which the current un-paused stretch began. */
  startedAt: number | null;
  /** Recorded ms accumulated before the current stretch (excludes paused time). */
  accumulatedMs: number;
  countdownEndsAt: number | null;
  maxSeconds: number;
  micEnabled: boolean;
  micMuted: boolean;
  cameraBubble: boolean;
  cameraId: string | null;
  hasSystemAudio: boolean;
  videoId: string | null;
  upload: UploadSnapshot | null;
  error: string | null;
  updatedAt: number;
}

export const RECORDING_KEY = 'spool:recording';

export const DEFAULT_MAX_SECONDS = 420;

export const IDLE_STATE: RecordingState = {
  phase: 'idle',
  mode: 'screen',
  recorderTabId: null,
  targetTabId: null,
  startedAt: null,
  accumulatedMs: 0,
  countdownEndsAt: null,
  maxSeconds: DEFAULT_MAX_SECONDS,
  micEnabled: true,
  micMuted: false,
  cameraBubble: false,
  cameraId: null,
  hasSystemAudio: false,
  videoId: null,
  upload: null,
  error: null,
  updatedAt: 0,
};

export const ACTIVE_PHASES: ReadonlySet<RecordingPhase> = new Set(['preparing', 'countdown', 'recording', 'paused', 'finalizing']);

export function isActive(state: RecordingState): boolean {
  return ACTIVE_PHASES.has(state.phase);
}

export function isCapturing(state: RecordingState): boolean {
  return state.phase === 'recording' || state.phase === 'paused';
}

export function elapsedMs(state: RecordingState, now: number = Date.now()): number {
  const running = state.phase === 'recording' && state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0;
  return state.accumulatedMs + running;
}

export async function readRecordingState(): Promise<RecordingState> {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  const value = stored[RECORDING_KEY] as RecordingState | undefined;
  return value ? { ...IDLE_STATE, ...value } : { ...IDLE_STATE };
}

export async function writeRecordingState(next: RecordingState): Promise<RecordingState> {
  const stamped = { ...next, updatedAt: Date.now() };
  await chrome.storage.session.set({ [RECORDING_KEY]: stamped });
  return stamped;
}

export async function patchRecordingState(patch: Partial<RecordingState>): Promise<RecordingState> {
  const current = await readRecordingState();
  return writeRecordingState({ ...current, ...patch });
}

export async function resetRecordingState(): Promise<void> {
  await writeRecordingState({ ...IDLE_STATE });
}

export function subscribeRecordingState(listener: (state: RecordingState) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'session' || !(RECORDING_KEY in changes)) return;
    const value = changes[RECORDING_KEY]?.newValue as RecordingState | undefined;
    listener(value ? { ...IDLE_STATE, ...value } : { ...IDLE_STATE });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
