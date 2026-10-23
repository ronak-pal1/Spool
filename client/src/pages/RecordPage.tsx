import { formatBytes, formatTimestamp, type UploadProgress } from '@spool/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Chrome,
  Mic,
  MicOff,
  Monitor,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Square,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Menu } from '@/components/ui/Menu';
import { Kbd, Spinner, Switch } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/Tooltip';
import { api, errorMessage, queryClient, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/hooks';
import { describeMediaError, openCamera, openMicrophone, stopStream, WebRecorder, type CaptureMode } from '@/lib/web-recorder';
import { toast } from '@/store/toast.store';

type Phase = 'setup' | 'starting' | 'countdown' | 'recording' | 'finalizing';

const MODES: { value: CaptureMode; label: string; description: string; icon: ReactNode }[] = [
  { value: 'screen-camera', label: 'Screen + Camera', description: 'Your screen with a floating camera bubble', icon: <MonitorPlay className="h-5 w-5" /> },
  { value: 'screen', label: 'Screen only', description: 'A tab, window or entire display', icon: <Monitor className="h-5 w-5" /> },
  { value: 'camera', label: 'Camera only', description: 'Talk straight to your viewers', icon: <Camera className="h-5 w-5" /> },
];

function useDevices(kind: MediaDeviceKind, refreshKey: number) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let active = true;
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => active && setDevices(list.filter((d) => d.kind === kind && d.deviceId)))
        .catch(() => undefined);
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, [kind, refreshKey]);
  return devices;
}

function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let smoothed = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      smoothed = smoothed * 0.75 + Math.min(1, rms * 4) * 0.25;
      setLevel(smoothed);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      void context.close();
    };
  }, [stream]);
  return level;
}

export function RecordPage() {
  useDocumentTitle('Record');
  const navigate = useNavigate();
  const health = useQuery({ queryKey: queryKeys.health, queryFn: () => api.health(), staleTime: 60_000 });
  const limit = health.data?.maxRecordingSeconds ?? 300;

  const [mode, setMode] = useState<CaptureMode>('screen-camera');
  const [micEnabled, setMicEnabled] = useState(true);
  const [micId, setMicId] = useState<string | null>(localStorage.getItem('spool-mic'));
  const [cameraId, setCameraId] = useState<string | null>(localStorage.getItem('spool-camera'));
  const [micPreview, setMicPreview] = useState<MediaStream | null>(null);
  const [cameraPreview, setCameraPreview] = useState<MediaStream | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [deviceRefresh, setDeviceRefresh] = useState(0);
  const mics = useDevices('audioinput', deviceRefresh);
  const cameras = useDevices('videoinput', deviceRefresh);

  const [phase, setPhase] = useState<Phase>('setup');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const recorderRef = useRef<WebRecorder | null>(null);
  const clock = useRef({ startedAt: 0, accumulated: 0, running: false });
  const finishingRef = useRef(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const micLevel = useAudioLevel(phase === 'setup' ? micPreview : null);
  const needsCamera = mode !== 'screen';

  useEffect(() => {
    if (phase !== 'setup' || !micEnabled) {
      setMicPreview((prev) => {
        stopStream(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    openMicrophone(micId)
      .then((stream) => {
        if (cancelled) return stopStream(stream);
        setPermissionError(null);
        setDeviceRefresh((n) => n + 1);
        setMicPreview((prev) => {
          stopStream(prev);
          return stream;
        });
      })
      .catch((error) => !cancelled && setPermissionError(describeMediaError(error)));
    return () => {
      cancelled = true;
    };
  }, [micEnabled, micId, phase]);

  useEffect(() => {
    if (phase !== 'setup') return;
    if (!needsCamera) {
      setCameraPreview((prev) => {
        stopStream(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    openCamera(cameraId)
      .then((stream) => {
        if (cancelled) return stopStream(stream);
        setPermissionError(null);
        setDeviceRefresh((n) => n + 1);
        setCameraPreview((prev) => {
          stopStream(prev);
          return stream;
        });
      })
      .catch((error) => !cancelled && setPermissionError(describeMediaError(error)));
    return () => {
      cancelled = true;
    };
  }, [needsCamera, cameraId, phase]);

  const previewRef = useRef({ micPreview, cameraPreview });
  previewRef.current = { micPreview, cameraPreview };
  useEffect(
    () => () => {
      stopStream(previewRef.current.micPreview);
      stopStream(previewRef.current.cameraPreview);
      const recorder = recorderRef.current;
      if (recorder) void recorder.cancel();
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    },
    [],
  );

  const elapsedNow = useCallback(() => {
    const c = clock.current;
    return c.accumulated + (c.running ? (performance.now() - c.startedAt) / 1000 : 0);
  }, []);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || finishingRef.current) return;
    finishingRef.current = true;
    const duration = elapsedNow();
    clock.current.running = false;
    setPhase('finalizing');
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    try {
      const shareId = await recorder.finish(duration);
      recorderRef.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      toast.success('Recording uploaded', 'Transcribing and summarizing now.');
      navigate(`/s/${shareId}`, { replace: true });
    } catch (error) {
      toast.error('Upload failed', errorMessage(error));
      recorderRef.current = null;
      finishingRef.current = false;
      setPhase('setup');
    }
  }, [elapsedNow, navigate]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = window.setInterval(() => {
      const value = elapsedNow();
      setElapsed(value);
      if (value >= limit) void finish();
    }, 200);
    return () => window.clearInterval(interval);
  }, [phase, limit, elapsedNow, finish]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      const recorder = recorderRef.current;
      if (!recorder) return;
      recorder
        .start()
        .then(() => {
          clock.current = { startedAt: performance.now(), accumulated: 0, running: true };
          setElapsed(0);
          setPhase('recording');
        })
        .catch((error) => {
          toast.error('Could not start recording', errorMessage(error));
          void recorder.cancel();
          recorderRef.current = null;
          setPhase('setup');
        });
      return;
    }
    const timer = window.setTimeout(() => setCount((c) => c - 1), 850);
    return () => window.clearTimeout(timer);
  }, [phase, count]);

  const bindVideo = (stream: MediaStream | null | undefined, holder?: MutableRefObject<HTMLVideoElement | null>) => (element: HTMLVideoElement | null) => {
    if (!element) return;
    if (holder) holder.current = element;
    const next = stream ?? null;
    if (element.srcObject !== next) element.srcObject = next;
  };

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'countdown' && phase !== 'finalizing') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => (phase === 'recording' || phase === 'countdown') && currentLocation.pathname !== nextLocation.pathname);

  const popOutCamera = useCallback(async () => {
    const video = cameraVideoRef.current;
    if (!video || !document.pictureInPictureEnabled) return false;
    try {
      if (video.readyState < 1) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
      await video.play().catch(() => undefined);
      await video.requestPictureInPicture();
      return true;
    } catch {
      return false;
    }
  }, []);

  const begin = async () => {
    if (micId) localStorage.setItem('spool-mic', micId);
    if (cameraId) localStorage.setItem('spool-camera', cameraId);
    setPhase('starting');
    const recorder = new WebRecorder({
      onSourceEnded: () => {
        if (recorderRef.current === recorder) void finish();
      },
      onUploadProgress: setUpload,
      onError: (error) => toast.error('Recording error', error.message),
    });
    try {
      await recorder.acquire({ mode, micEnabled, micId, cameraId }, cameraPreview);
    } catch (error) {
      recorder.releaseAll();
      setPhase('setup');
      const message = describeMediaError(error);
      if ((error as DOMException).name !== 'NotAllowedError' || mode === 'camera') toast.error('Could not start capture', message);
      return;
    }
    if (recorder.cameraStream === cameraPreview) setCameraPreview(null);
    recorderRef.current = recorder;
    finishingRef.current = false;
    setUpload(null);
    setPaused(false);
    setMicMuted(false);
    setCount(3);
    setPhase('countdown');
    if (mode === 'screen-camera' && document.pictureInPictureEnabled) {
      window.setTimeout(() => {
        void popOutCamera().then((ok) => {
          if (!ok) toast.info('Pop out your camera', 'Use the picture-in-picture button so your camera bubble floats over every window.');
        });
      }, 450);
    }
  };

  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const c = clock.current;
    if (paused) {
      recorder.resume();
      c.startedAt = performance.now();
      c.running = true;
    } else {
      recorder.pause();
      c.accumulated = elapsedNow();
      c.running = false;
    }
    setPaused(!paused);
  };

  const toggleMute = () => {
    const next = !micMuted;
    recorderRef.current?.setMicMuted(next);
    setMicMuted(next);
  };

  const restart = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    clock.current.running = false;
    await recorder.discardTake();
    setPaused(false);
    setUpload(null);
    setElapsed(0);
    setCount(3);
    setPhase('countdown');
  };

  const discard = async () => {
    setConfirmDiscard(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clock.current.running = false;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    if (recorder) await recorder.cancel();
    setPhase('setup');
    toast.info('Recording discarded');
  };

  const remaining = Math.max(0, limit - elapsed);
  const nearLimit = remaining <= 30;
  const progress = Math.min(1, elapsed / limit);

  return (
    <div className="relative min-h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-accent-radial" />
      <AnimatePresence mode="wait">
        {phase === 'setup' || phase === 'starting' ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            className="relative mx-auto grid w-full max-w-6xl gap-8 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px]"
          >
            <div>
              <p className="label">New recording</p>
              <h1 className="mt-1.5 text-[28px] font-semibold tracking-tight text-white">What would you like to record?</h1>
              <p className="mt-1.5 text-sm text-white/45">Up to {Math.round(limit / 60)} minutes. Your recording uploads while you talk, so it's ready to share the moment you stop.</p>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {MODES.map((option) => {
                  const active = option.value === mode;
                  return (
                    <motion.button
                      key={option.value}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setMode(option.value)}
                      className={cn(
                        'relative overflow-hidden rounded-2xl border p-4 text-left transition-colors',
                        active ? 'border-accent/50 bg-accent/[0.06]' : 'border-white/[0.08] bg-ink-850 hover:border-white/15',
                      )}
                    >
                      {active && <motion.span layoutId="mode-glow" className="absolute inset-0 bg-gradient-to-br from-accent/15 via-transparent to-transparent" transition={{ type: 'spring', stiffness: 400, damping: 36 }} />}
                      <span className={cn('relative flex h-10 w-10 items-center justify-center rounded-xl border', active ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/[0.03] text-white/55')}>
                        {option.icon}
                      </span>
                      <p className="relative mt-4 text-sm font-semibold text-white">{option.label}</p>
                      <p className="relative mt-1 text-xs leading-relaxed text-white/45">{option.description}</p>
                      {active && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </motion.span>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <div className="surface relative mt-6 aspect-video overflow-hidden">
                <div className="absolute inset-0 bg-grid-fade bg-[size:32px_32px] opacity-60" />
                {mode !== 'camera' && (
                  <div className="absolute inset-6 flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-ink-900/40 text-center">
                    <div className="text-white/35">
                      <Monitor className="mx-auto h-8 w-8" />
                      <p className="mt-2 text-xs">You'll pick a tab, window or screen after pressing record</p>
                    </div>
                  </div>
                )}
                <AnimatePresence>
                  {needsCamera && (
                    <motion.div
                      key="cam"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                      className={cn(
                        'absolute overflow-hidden bg-ink-800 shadow-pop ring-2 ring-accent/40',
                        mode === 'camera' ? 'inset-0 rounded-none ring-0' : 'bottom-6 left-6 h-36 w-36 rounded-full',
                      )}
                    >
                      <video ref={bindVideo(cameraPreview)} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
                      {!cameraPreview && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Spinner />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="space-y-4 lg:pt-[92px]">
              <div className="surface space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    {micEnabled ? <Mic className="h-4 w-4 text-accent" /> : <MicOff className="h-4 w-4 text-white/40" />}
                    Microphone
                  </span>
                  <Switch checked={micEnabled} onChange={setMicEnabled} label="Microphone" />
                </div>
                {micEnabled && (
                  <>
                    <DevicePicker devices={mics} value={micId} onChange={setMicId} placeholder="Default microphone" />
                    <div className="flex h-6 items-end gap-[3px]">
                      {Array.from({ length: 28 }, (_, i) => {
                        const threshold = i / 28;
                        const on = micLevel > threshold;
                        return (
                          <span
                            key={i}
                            className={cn('w-full rounded-full transition-[height,background-color] duration-75', on ? (threshold > 0.8 ? 'bg-warn' : 'bg-accent') : 'bg-white/10')}
                            style={{ height: on ? `${30 + threshold * 70}%` : '22%' }}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {needsCamera && (
                <div className="surface space-y-4 p-5">
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Camera className="h-4 w-4 text-accent" /> Camera
                  </span>
                  <DevicePicker devices={cameras} value={cameraId} onChange={setCameraId} placeholder="Default camera" />
                </div>
              )}

              <AnimatePresence>
                {permissionError && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-start gap-2 overflow-hidden rounded-xl border border-warn/25 bg-warn/10 px-3 py-2.5 text-xs text-warn"
                  >
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {permissionError}
                  </motion.p>
                )}
              </AnimatePresence>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={phase === 'starting'}
                onClick={() => void begin()}
                leftIcon={<span className="h-2.5 w-2.5 rounded-full bg-accent-foreground" />}
              >
                Start recording
              </Button>
              {mode !== 'screen' && mode !== 'camera' && (
                <p className="text-center text-xs text-white/35">Your camera pops out into a floating window so it appears in the screen recording.</p>
              )}
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.06] p-4 text-xs leading-relaxed text-white/45">
                <Chrome className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                <span>
                  Want click-tracked auto zoom, system audio on macOS and a draggable camera bubble on every app? Use the Spool Chrome extension or desktop app.
                </span>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative flex min-h-full flex-col items-center px-5 pb-36 pt-8 sm:px-8">
            <div className="relative w-full max-w-5xl">
              <div className="surface relative aspect-video overflow-hidden bg-black">
                {mode === 'camera' ? (
                  <video ref={bindVideo(recorderRef.current?.cameraStream)} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
                ) : (
                  <>
                    <video ref={bindVideo(recorderRef.current?.displayStream)} autoPlay muted playsInline className="h-full w-full object-contain" />
                    {mode === 'screen-camera' && (
                      <div className="absolute bottom-4 left-4 h-28 w-28 overflow-hidden rounded-full shadow-pop ring-2 ring-accent/50">
                        <video ref={bindVideo(recorderRef.current?.cameraStream, cameraVideoRef)} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
                      </div>
                    )}
                  </>
                )}
                {paused && phase === 'recording' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <span className="flex items-center gap-2 rounded-full border border-white/15 bg-ink-900/80 px-4 py-2 text-sm font-medium text-white">
                      <Pause className="h-4 w-4" /> Paused
                    </span>
                  </div>
                )}
              </div>
            </div>

            <AnimatePresence>
              {phase === 'countdown' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setCount(0)}
                  className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center bg-ink-950/70 backdrop-blur-md"
                >
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={count}
                      initial={{ scale: 1.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="text-[140px] font-semibold leading-none tracking-tighter text-white [text-shadow:0_0_60px_rgba(0,250,154,0.6)]"
                    >
                      {count > 0 ? count : <Spinner className="h-12 w-12" />}
                    </motion.span>
                  </AnimatePresence>
                  <p className="mt-6 text-sm text-white/50">Click anywhere to skip</p>
                </motion.div>
              )}
            </AnimatePresence>

            {phase === 'finalizing' ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass fixed bottom-8 left-0 right-0 mx-auto flex w-fit items-center gap-4 rounded-2xl px-5 py-4 shadow-pop">
                <UploadCloud className="h-5 w-5 text-accent" />
                <div>
                  <p className="text-sm font-medium text-white">Finishing upload…</p>
                  <p className="tabular text-xs text-white/45">
                    {upload ? `${formatBytes(upload.uploadedBytes)} of ${formatBytes(Math.max(upload.queuedBytes, upload.uploadedBytes))}` : 'Preparing'}
                  </p>
                </div>
                <Spinner />
              </motion.div>
            ) : (
              <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center px-4">
                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  className="glass-strong flex items-center gap-2 rounded-2xl p-2 shadow-pop"
                >
                  <div className="flex items-center gap-3 pl-2 pr-3">
                    <TimerRing progress={progress} warn={nearLimit} paused={paused} />
                    <div>
                      <p className={cn('tabular font-mono text-[15px] font-semibold', nearLimit ? 'text-warn' : 'text-white')}>{formatTimestamp(elapsed)}</p>
                      <p className="tabular text-2xs text-white/40">{nearLimit ? `${Math.ceil(remaining)}s left` : `of ${formatTimestamp(limit)}`}</p>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-white/10" />
                  <HudButton label={paused ? 'Resume' : 'Pause'} onClick={togglePause} disabled={phase !== 'recording'}>
                    {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
                  </HudButton>
                  {recorderRef.current?.hasMic && (
                    <HudButton label={micMuted ? 'Unmute mic' : 'Mute mic'} onClick={toggleMute} active={micMuted}>
                      {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </HudButton>
                  )}
                  {mode === 'screen-camera' && document.pictureInPictureEnabled && (
                    <HudButton label="Pop out camera" onClick={() => void popOutCamera()}>
                      {recorderRef.current?.cameraStream ? <PictureInPicture2 className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                    </HudButton>
                  )}
                  <HudButton label="Restart" onClick={() => void restart()} disabled={phase !== 'recording'}>
                    <RotateCcw className="h-4 w-4" />
                  </HudButton>
                  <HudButton label="Discard" onClick={() => setConfirmDiscard(true)} danger>
                    <Trash2 className="h-4 w-4" />
                  </HudButton>
                  <Button variant="danger" className="ml-1 rounded-xl" onClick={() => void finish()} disabled={phase !== 'recording'} leftIcon={<Square className="h-3.5 w-3.5 fill-current" />}>
                    Stop
                  </Button>
                </motion.div>
              </div>
            )}

            {phase === 'recording' && upload && (
              <p className="tabular mt-4 flex items-center gap-2 text-xs text-white/35">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Streaming to cloud · {formatBytes(upload.uploadedBytes)} uploaded
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this recording?"
        description="Everything recorded so far will be deleted."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep recording
            </Button>
            <Button variant="danger" onClick={() => void discard()}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/50">
          Tip: press <Kbd>Restart</Kbd> instead to start a fresh take without leaving this screen.
        </p>
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Stop recording?"
        description="Leaving this page ends the recording. Do you want to save what you have?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                void discard().then(() => blocker.proceed?.());
              }}
            >
              Discard & leave
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                blocker.reset?.();
                void finish();
              }}
            >
              Save recording
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/50">Saving uploads the remaining parts and opens the video page.</p>
      </Dialog>
    </div>
  );
}

function DevicePicker({ devices, value, onChange, placeholder }: { devices: MediaDeviceInfo[]; value: string | null; onChange: (id: string | null) => void; placeholder: string }) {
  const current = devices.find((d) => d.deviceId === value);
  return (
    <Menu
      align="start"
      className="w-[300px]"
      items={[
        { label: placeholder, checked: !value || !current, onSelect: () => onChange(null) },
        ...devices
          .filter((d) => d.deviceId !== 'default')
          .map((d, i) => ({ label: d.label || `Device ${i + 1}`, checked: d.deviceId === value, onSelect: () => onChange(d.deviceId) })),
      ]}
      trigger={(props) => (
        <button {...props} className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-800/80 px-3 text-left text-[13px] text-white/80 transition-colors hover:border-white/20">
          <span className="truncate">{current?.label || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
        </button>
      )}
    />
  );
}

function HudButton({ label, children, onClick, disabled, active, danger }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean }) {
  return (
    <Tooltip content={label}>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
          active ? 'bg-danger/15 text-danger' : danger ? 'text-white/60 hover:bg-danger/10 hover:text-danger' : 'text-white/75 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

function TimerRing({ progress, warn, paused }: { progress: number; warn: boolean; paused: boolean }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="relative flex h-9 w-9 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        <motion.circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={warn ? '#FFB547' : '#00FA9A'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: circumference * (1 - progress) }}
          transition={{ duration: 0.25, ease: 'linear' }}
        />
      </svg>
      <span className={cn('h-2.5 w-2.5 rounded-full', paused ? 'bg-white/40' : 'animate-pulse bg-danger shadow-[0_0_10px_rgba(255,92,108,0.9)]')} />
    </span>
  );
}
