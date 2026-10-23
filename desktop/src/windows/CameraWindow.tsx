import { useEffect, useRef, useState } from 'react';

import { errorMessage, recorder, startDragging, useRecording, type Snapshot } from '../lib/bridge';
import { cn } from '../lib/cn';

const SIZES: Snapshot['cameraSize'][] = ['s', 'm', 'l', 'full'];

export function CameraWindow() {
  const snapshot = useRecording();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const live = snapshot.cameraEnabled && (snapshot.phase === 'countdown' || snapshot.phase === 'recording' || snapshot.phase === 'paused');

  useEffect(() => {
    if (!live) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const deviceId = snapshot.cameraDeviceId;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (video) video.srcObject = stream;
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [live, snapshot.cameraDeviceId]);

  if (!live) return <div className="h-full w-full" />;

  const full = snapshot.cameraSize === 'full';
  return (
    <div className={cn('group relative h-full w-full overflow-hidden bg-black', full ? '' : 'rounded-full')} onMouseDown={() => void startDragging()}>
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
      {error ? <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/70">{error}</div> : null}
      <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1 rounded-full bg-black/50 p-1 opacity-0 backdrop-blur-md transition group-hover:opacity-100">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void recorder.setCameraSize(size)}
            className={cn('rounded-full px-2 py-0.5 text-[10px] uppercase', snapshot.cameraSize === size ? 'bg-accent text-accent-foreground' : 'text-white/70')}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}
