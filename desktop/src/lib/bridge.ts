import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';

import type { AreaRect } from './settings';

export interface SourceInfo {
  id: string;
  kind: 'monitor' | 'window';
  name: string;
  appName: string | null;
  logical: AreaRect;
  scale: number;
  isPrimary: boolean;
  thumbnail: string | null;
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioInventory {
  microphones: AudioDevice[];
  system: AudioDevice[];
  systemAvailable: boolean;
  note: string | null;
}

export interface Snapshot {
  phase: 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing' | 'error';
  countdown: number | null;
  elapsedMs: number;
  limitMs: number;
  micMuted: boolean;
  systemMuted: boolean;
  micAttached: boolean;
  systemAttached: boolean;
  cameraEnabled: boolean;
  cameraDeviceId: string | null;
  cameraSize: 's' | 'm' | 'l' | 'full';
  cameraClickThrough: boolean;
  drawEnabled: boolean;
  progress: number;
  error: string | null;
  canRetry: boolean;
  shareId: string | null;
  webUrl: string | null;
  label: string | null;
}

export interface StartPayload {
  mode: 'screen' | 'window' | 'area';
  sourceId: string;
  area: AreaRect | null;
  micEnabled: boolean;
  micDeviceId: string | null;
  systemEnabled: boolean;
  systemDeviceId: string | null;
  cameraEnabled: boolean;
  cameraDeviceId: string | null;
  apiUrl: string;
  token: string;
  workspaceId: string | null;
  title?: string;
}

export const IDLE_SNAPSHOT: Snapshot = {
  phase: 'idle',
  countdown: null,
  elapsedMs: 0,
  limitMs: 420_000,
  micMuted: false,
  systemMuted: true,
  micAttached: false,
  systemAttached: false,
  cameraEnabled: false,
  cameraDeviceId: null,
  cameraSize: 'm',
  cameraClickThrough: false,
  drawEnabled: false,
  progress: 0,
  error: null,
  canRetry: false,
  shareId: null,
  webUrl: null,
  label: null,
};

export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

export async function windowLabel(): Promise<string> {
  if (!inTauri()) return 'main';
  return getCurrentWindow().label;
}

export function useWindowLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void windowLabel().then((value) => {
      if (!cancelled) setLabel(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return label;
}

export function useRecording(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(IDLE_SNAPSHOT);
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const current = await invoke<Snapshot>('recording_snapshot');
        if (!cancelled) setSnapshot(current);
      } catch {
        // The overlay can render before the command bridge is ready.
      }
      const stop = await listen<Snapshot>('recording-state', (event) => setSnapshot(event.payload));
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return snapshot;
}

export const recorder = {
  listSources: () => invoke<SourceInfo[]>('list_sources'),
  listAudio: () => invoke<AudioInventory>('list_audio_devices'),
  start: (payload: StartPayload) => invoke<Snapshot>('start_recording', { request: payload }),
  pause: () => invoke<Snapshot>('pause_recording'),
  resume: () => invoke<Snapshot>('resume_recording'),
  setMicMuted: (muted: boolean) => invoke<Snapshot>('set_mic_muted', { muted }),
  setSystemMuted: (muted: boolean) => invoke<Snapshot>('set_system_muted', { muted }),
  stop: () => invoke<Snapshot>('stop_recording'),
  discard: () => invoke<Snapshot>('discard_recording'),
  restart: () => invoke<Snapshot>('restart_recording'),
  retry: () => invoke<Snapshot>('retry_upload'),
  prepareArea: (sourceId: string) => invoke<void>('prepare_area_select', { sourceId }),
  cancelArea: () => invoke<void>('cancel_area_select'),
  completeArea: (rect: AreaRect) => invoke<AreaRect>('complete_area_select', { rect }),
  setCameraSize: (size: Snapshot['cameraSize']) => invoke<Snapshot>('set_camera_size', { size }),
  setCameraClickThrough: (enabled: boolean) => invoke<Snapshot>('set_camera_click_through', { enabled }),
  setDrawEnabled: (enabled: boolean) => invoke<Snapshot>('set_draw_enabled', { enabled }),
};

export async function openExternal(url: string): Promise<void> {
  if (inTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function startDragging(): Promise<void> {
  if (!inTauri()) return;
  await getCurrentWindow().startDragging();
}
