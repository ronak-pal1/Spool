import type { User, Workspace } from '@spool/shared';
import type { CaptureMode } from './state';

export interface RecordingPrefs {
  mode: CaptureMode;
  cameraBubble: boolean;
  micEnabled: boolean;
  micId: string | null;
  cameraId: string | null;
}

export interface ExtensionSettings {
  apiUrl: string;
  webUrl: string | null;
  token: string | null;
  user: User | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  prefs: RecordingPrefs;
}

export const SETTINGS_KEY = 'spool:settings';

export const DEFAULT_API_URL = 'http://localhost:4000';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: DEFAULT_API_URL,
  webUrl: null,
  token: null,
  user: null,
  workspaces: [],
  activeWorkspaceId: null,
  prefs: {
    mode: 'screen',
    cameraBubble: true,
    micEnabled: true,
    micId: null,
    cameraId: null,
  },
};

export function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function merge(stored: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    prefs: { ...DEFAULT_SETTINGS.prefs, ...stored?.prefs },
  };
}

export async function readSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return merge(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function writeSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await readSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function writePrefs(patch: Partial<RecordingPrefs>): Promise<ExtensionSettings> {
  const current = await readSettings();
  return writeSettings({ prefs: { ...current.prefs, ...patch } });
}

export async function clearSession(): Promise<ExtensionSettings> {
  return writeSettings({ token: null, user: null, workspaces: [], activeWorkspaceId: null });
}

export function subscribeSettings(listener: (settings: ExtensionSettings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
    listener(merge(changes[SETTINGS_KEY]?.newValue as Partial<ExtensionSettings> | undefined));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
