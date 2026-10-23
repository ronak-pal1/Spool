import type { User, Workspace } from '@spool/shared';
import { useSyncExternalStore } from 'react';

const KEY = 'spool.desktop.v1';

export interface AreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Prefs {
  mode: 'screen' | 'window' | 'area';
  sourceId: string | null;
  area: AreaRect | null;
  micEnabled: boolean;
  micDeviceId: string | null;
  systemEnabled: boolean;
  systemDeviceId: string | null;
  cameraEnabled: boolean;
  cameraDeviceId: string | null;
  cameraSize: 's' | 'm' | 'l' | 'full';
}

export interface DesktopSettings {
  apiUrl: string;
  token: string | null;
  user: User | null;
  workspaces: Workspace[];
  workspaceId: string | null;
  prefs: Prefs;
}

const DEFAULT_PREFS: Prefs = {
  mode: 'screen',
  sourceId: null,
  area: null,
  micEnabled: true,
  micDeviceId: null,
  systemEnabled: false,
  systemDeviceId: null,
  cameraEnabled: false,
  cameraDeviceId: null,
  cameraSize: 'm',
};

const DEFAULTS: DesktopSettings = {
  apiUrl: 'http://localhost:4000',
  token: null,
  user: null,
  workspaces: [],
  workspaceId: null,
  prefs: DEFAULT_PREFS,
};

let cacheRaw = '';
let cache: DesktopSettings = DEFAULTS;
const listeners = new Set<() => void>();

function normalize(value: unknown): DesktopSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DesktopSettings>;
  const prefs = (raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {}) as Partial<Prefs>;
  return {
    apiUrl: typeof raw.apiUrl === 'string' && raw.apiUrl.trim() ? raw.apiUrl.trim() : DEFAULTS.apiUrl,
    token: typeof raw.token === 'string' ? raw.token : null,
    user: raw.user ?? null,
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : null,
    prefs: { ...DEFAULT_PREFS, ...prefs },
  };
}

function read(): DesktopSettings {
  const raw = localStorage.getItem(KEY) ?? '';
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    cache = raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function currentSettings(): DesktopSettings {
  return read();
}

export function updateSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = normalize({ ...read(), ...patch });
  cache = next;
  cacheRaw = JSON.stringify(next);
  localStorage.setItem(KEY, cacheRaw);
  emit();
  return next;
}

export function updatePrefs(patch: Partial<Prefs>): DesktopSettings {
  return updateSettings({ prefs: { ...read().prefs, ...patch } });
}

export function useSettings(): DesktopSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === KEY) listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    read,
    read,
  );
}
