import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, readSettings, subscribeSettings, type ExtensionSettings } from './settings';
import { IDLE_STATE, readRecordingState, subscribeRecordingState, type RecordingState } from './state';

export function useSettings(): { settings: ExtensionSettings; loaded: boolean } {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void readSettings().then((value) => {
      if (!alive) return;
      setSettings(value);
      setLoaded(true);
    });
    const unsubscribe = subscribeSettings((value) => {
      setSettings(value);
      setLoaded(true);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { settings, loaded };
}

export function useRecordingState(): { state: RecordingState; loaded: boolean } {
  const [state, setState] = useState<RecordingState>(IDLE_STATE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void readRecordingState().then((value) => {
      if (!alive) return;
      setState(value);
      setLoaded(true);
    });
    const unsubscribe = subscribeRecordingState((value) => {
      setState(value);
      setLoaded(true);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { state, loaded };
}

/** Re-renders on an interval while `active`, returning the current wall-clock time. */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
