import { useCallback, useEffect, useState } from 'react';
import { listDevices, openMicrophone, queryPermission, stopStream, type MediaDeviceOption, type PermissionValue } from '@/lib/media';

export interface MediaAccess {
  microphone: PermissionValue;
  camera: PermissionValue;
  microphones: MediaDeviceOption[];
  cameras: MediaDeviceOption[];
  loaded: boolean;
  refresh: () => void;
}

export function useMediaAccess(): MediaAccess {
  const [microphone, setMicrophone] = useState<PermissionValue>('prompt');
  const [camera, setCamera] = useState<PermissionValue>('prompt');
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void Promise.all([queryPermission('microphone'), queryPermission('camera'), listDevices().catch(() => ({ microphones: [], cameras: [] }))]).then(
      ([mic, cam, devices]) => {
        setMicrophone(mic);
        setCamera(cam);
        setMicrophones(devices.microphones);
        setCameras(devices.cameras);
        setLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { microphone, camera, microphones, cameras, loaded, refresh };
}

/** Live input level (0..1) for the selected microphone, used to confirm the mic works before recording. */
export function useMicLevel(deviceId: string | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      return;
    }
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame: number | null = null;
    let cancelled = false;
    void openMicrophone(deviceId)
      .then((opened) => {
        if (cancelled) {
          stopStream(opened);
          return;
        }
        stream = opened;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(opened).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let smoothed = 0;
        let lastPaint = 0;
        const loop = (time: number) => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const sample of data) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / data.length);
          smoothed = Math.max(rms * 3.2, smoothed * 0.86);
          if (time - lastPaint > 60) {
            lastPaint = time;
            setLevel(Math.min(1, smoothed));
          }
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      })
      .catch(() => setLevel(0));
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      stopStream(stream);
      if (context && context.state !== 'closed') void context.close();
    };
  }, [deviceId, enabled]);
  return level;
}
