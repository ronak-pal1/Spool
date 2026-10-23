import type { CaptureMode } from './state';

export type RecorderCommand = 'pause' | 'resume' | 'toggle-pause' | 'stop' | 'restart' | 'discard' | 'toggle-mic';

export interface StartOptions {
  mode: CaptureMode;
  micEnabled: boolean;
  micId: string | null;
  cameraBubble: boolean;
  cameraId: string | null;
}

export interface RecorderBootstrap {
  options: StartOptions;
  originTabId: number | null;
  /** Tab-capture stream id, minted by the service worker for tab mode. */
  tabStreamId: string | null;
}

export type ExtensionMessage =
  | { type: 'spool:start'; options: StartOptions; tabId: number | null }
  | { type: 'spool:recorder-init' }
  | { type: 'spool:command'; command: RecorderCommand }
  | { type: 'spool:click'; x: number; y: number }
  | { type: 'spool:whoami' }
  | { type: 'spool:ping' }
  | { type: 'spool:focus-recorder' }
  | { type: 'spool:open'; url: string };

export type MessageResponse<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' && (value as { type: string }).type.startsWith('spool:');
}

/** Sends a runtime message and unwraps the `{ ok, data | error }` envelope. */
export async function request<T>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
  if (!response) throw new Error('Spool did not respond. Reload the extension and try again.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** Fire-and-forget delivery; it is fine when no context is listening (e.g. no recorder yet). */
export function notify(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

export function sendCommand(command: RecorderCommand): void {
  notify({ type: 'spool:command', command });
}
