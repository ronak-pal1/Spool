import { sourceToEdited, type EditConfig } from '@spool/shared';
import { useCallback, useEffect, useRef } from 'react';
import { api, API_URL } from './api';
import { viewerSession } from './viewer';

const BUCKETS = 20;
const HEARTBEAT_MS = 10_000;

interface TrackerState {
  viewId: string | null;
  starting: boolean;
  watched: number;
  lastSource: number | null;
  lastAt: number;
  position: number;
  buckets: number[];
  dirty: boolean;
}

/**
 * Records a view on first play, accumulates real watch time and which tenths of the edited
 * timeline were seen, and flushes heartbeats periodically plus once more when the tab hides.
 */
export function useViewTracking(shareId: string, shareToken: string | null, edit: EditConfig, editedLength: number) {
  const state = useRef<TrackerState>({
    viewId: null,
    starting: false,
    watched: 0,
    lastSource: null,
    lastAt: 0,
    position: 0,
    buckets: Array.from({ length: BUCKETS }, () => 0),
    dirty: false,
  });
  const editRef = useRef(edit);
  editRef.current = edit;
  const lengthRef = useRef(editedLength);
  lengthRef.current = editedLength;

  const payload = useCallback(() => {
    const s = state.current;
    return {
      watchedSeconds: Math.round(s.watched * 10) / 10,
      position: Math.max(0, Math.round(s.position * 10) / 10),
      duration: Math.max(0, Math.round(lengthRef.current * 10) / 10),
      buckets: s.buckets,
    };
  }, []);

  const flush = useCallback(
    (beacon = false) => {
      const s = state.current;
      if (!s.viewId || !s.dirty) return;
      s.dirty = false;
      const body = payload();
      if (beacon) {
        try {
          void fetch(`${API_URL}/api/views/${s.viewId}`, {
            method: 'PATCH',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Viewer-Session': viewerSession() },
            body: JSON.stringify(body),
          }).catch(() => undefined);
        } catch {
          s.dirty = true;
        }
        return;
      }
      api.heartbeatView(s.viewId, body, viewerSession()).catch(() => {
        s.dirty = true;
      });
    },
    [payload],
  );

  const begin = useCallback(() => {
    const s = state.current;
    if (s.viewId || s.starting) return;
    s.starting = true;
    api
      .startView(shareId, viewerSession(), shareToken)
      .then((session) => {
        s.viewId = session.viewId;
        if (s.viewId) {
          s.dirty = true;
          flush();
        }
      })
      .catch(() => {
        s.starting = false;
      });
  }, [shareId, shareToken, flush]);

  const tick = useCallback((sourceTime: number, playing: boolean) => {
    const s = state.current;
    const now = performance.now();
    const edited = sourceToEdited(editRef.current, sourceTime);
    if (playing && s.lastSource !== null) {
      const wall = (now - s.lastAt) / 1000;
      const advanced = sourceTime - s.lastSource;
      if (advanced > 0 && advanced < 3 && wall < 3) {
        s.watched += Math.min(wall * 2.5, advanced);
        s.dirty = true;
      }
    }
    if (playing) {
      const length = lengthRef.current;
      if (length > 0) {
        const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor((edited / length) * BUCKETS)));
        if (s.buckets[index] !== 1) {
          s.buckets[index] = 1;
          s.dirty = true;
        }
      }
      s.position = Math.max(s.position, edited);
    }
    s.lastSource = playing ? sourceTime : null;
    s.lastAt = now;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => flush(), HEARTBEAT_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
    };
  }, [flush]);

  return { begin, tick };
}
