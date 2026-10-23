import { formatBytes, formatTimestamp } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Download, Mic, MicOff, Pause, Play, RefreshCw, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNow } from '@/lib/hooks';
import { elapsedMs, type RecordingState } from '@/lib/state';
import { cn } from '@/ui/cn';
import { Button, Logo, Spinner, spring } from '@/ui/primitives';
import type { RecorderEngine } from './engine';

const TITLES: Record<RecordingState['phase'], string> = {
  idle: 'Spool recorder',
  preparing: 'Preparing…',
  countdown: 'Starting…',
  recording: '● Recording',
  paused: '❚❚ Paused',
  finalizing: 'Uploading…',
  error: 'Recording needs attention',
};

export function RecorderApp({ engine }: { engine: RecorderEngine }) {
  const view = useSyncExternalStore(engine.subscribe, engine.getView);
  const { state, failure, previewStream, completed } = view;
  const now = useNow(state.phase === 'recording' || state.phase === 'countdown', 200);
  const elapsed = elapsedMs(state, now) / 1000;

  useEffect(() => {
    document.title = state.phase === 'recording' || state.phase === 'paused' ? `${TITLES[state.phase]} · ${formatTimestamp(elapsed)}` : `Spool · ${TITLES[state.phase]}`;
  }, [state.phase, elapsed]);

  const isCamera = state.mode === 'camera';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-accent-radial" />
      <header className="relative flex items-center justify-between px-8 py-6">
        <Logo />
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,250,154,0.8)]" />
          Keep this tab open while you record
        </span>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pb-16">
        <div className={cn('w-full', isCamera ? 'max-w-3xl' : 'max-w-md')}>
          {isCamera && (state.phase === 'countdown' || state.phase === 'recording' || state.phase === 'paused' || state.phase === 'preparing') ? (
            <CameraStage stream={previewStream} state={state} elapsed={elapsed} now={now} engine={engine} />
          ) : (
            <motion.div layout transition={spring} className="surface glass overflow-hidden p-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={completed ? 'done' : state.phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                  {completed ? (
                    <Done />
                  ) : failure ? (
                    <Failure engine={engine} message={failure.message} canRetry={failure.canRetryUpload} canDownload={failure.canDownload} />
                  ) : state.phase === 'preparing' || state.phase === 'idle' ? (
                    <Preparing mode={state.mode} />
                  ) : state.phase === 'countdown' ? (
                    <Countdown endsAt={state.countdownEndsAt} now={now} engine={engine} />
                  ) : state.phase === 'finalizing' ? (
                    <Uploading state={state} />
                  ) : (
                    <Live state={state} elapsed={elapsed} engine={engine} />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}

function Preparing({ mode }: { mode: RecordingState['mode'] }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <Spinner className="h-9 w-9" />
      <h1 className="mt-6 text-lg font-semibold text-white">{mode === 'screen' ? 'Choose what to share' : mode === 'tab' ? 'Connecting to your tab' : 'Starting your camera'}</h1>
      <p className="mt-2 max-w-xs text-sm text-white/50">
        {mode === 'screen' ? 'Pick a screen, window or tab in Chrome’s dialog. Tick “Share audio” to include sound.' : 'This only takes a moment.'}
      </p>
    </div>
  );
}

function Countdown({ endsAt, now, engine }: { endsAt: number | null; now: number; engine: RecorderEngine }) {
  const seconds = endsAt ? Math.max(1, Math.ceil((endsAt - now) / 1000)) : 3;
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <div className="relative flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-ink-950/60 shadow-glow">
        <AnimatePresence mode="popLayout">
          <motion.span key={seconds} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} className="text-6xl font-bold text-white tabular">
            {seconds}
          </motion.span>
        </AnimatePresence>
      </div>
      <p className="mt-6 text-sm text-white/55">Recording starts in a moment</p>
      <Button variant="ghost" className="mt-4" onClick={() => void engine.discard()}>
        Cancel
      </Button>
    </div>
  );
}

function useConfirm(): [string | null, (key: string) => void, () => void] {
  const [pending, setPending] = useState<string | null>(null);
  const ask = useCallback((key: string) => setPending(key), []);
  const clear = useCallback(() => setPending(null), []);
  return [pending, ask, clear];
}

function Controls({ state, engine, compact = false }: { state: RecordingState; engine: RecorderEngine; compact?: boolean }) {
  const [pending, ask, clear] = useConfirm();
  const paused = state.phase === 'paused';
  return (
    <div>
      <div className={cn('flex items-center justify-center gap-2', compact && 'gap-1.5')}>
        <RoundButton label={paused ? 'Resume' : 'Pause'} onClick={() => (paused ? engine.resume() : engine.pause())}>
          {paused ? <Play className="h-[18px] w-[18px] fill-current" /> : <Pause className="h-[18px] w-[18px] fill-current" />}
        </RoundButton>
        <RoundButton label={!state.micEnabled ? 'No microphone' : state.micMuted ? 'Unmute' : 'Mute'} onClick={() => engine.toggleMic()} disabled={!state.micEnabled} active={state.micMuted}>
          {state.micMuted || !state.micEnabled ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
        </RoundButton>
        <RoundButton label="Restart" onClick={() => ask('restart')}>
          <RotateCcw className="h-[18px] w-[18px]" />
        </RoundButton>
        <RoundButton label="Discard" onClick={() => ask('discard')} danger>
          <Trash2 className="h-[18px] w-[18px]" />
        </RoundButton>
        <Button variant="primary" size="lg" className="ml-2" leftIcon={<Square className="h-3.5 w-3.5 fill-current" />} onClick={() => void engine.finish()}>
          Stop & share
        </Button>
      </div>
      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0, y: -4, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -4, height: 0 }} className="overflow-hidden">
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-950/70 px-4 py-3">
              <span className="text-sm text-white/75">{pending === 'restart' ? 'Start over? This take will be deleted.' : 'Discard this recording for good?'}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={clear}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant={pending === 'discard' ? 'danger' : 'secondary'}
                  onClick={() => {
                    clear();
                    if (pending === 'restart') void engine.restart();
                    else void engine.discard();
                  }}
                >
                  {pending === 'restart' ? 'Restart' : 'Discard'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Live({ state, elapsed, engine }: { state: RecordingState; elapsed: number; engine: RecorderEngine }) {
  const remaining = Math.max(0, state.maxSeconds - elapsed);
  const progress = Math.min(1, elapsed / Math.max(1, state.maxSeconds));
  return (
    <div className="text-center">
      <span className={cn('inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]', state.phase === 'paused' ? 'text-warn' : 'text-[#FF6B7A]')}>
        <span className={cn('h-2 w-2 rounded-full', state.phase === 'paused' ? 'bg-warn' : 'animate-pulse bg-[#FF3B4E]')} />
        {state.phase === 'paused' ? 'Paused' : 'Recording'}
      </span>
      <div className={cn('mt-4 text-6xl font-semibold tracking-tight tabular', remaining <= 15 ? 'text-danger' : remaining <= 60 ? 'text-warn' : 'text-white')}>{formatTimestamp(elapsed)}</div>
      <div className="mt-2 text-sm text-white/40 tabular">{formatTimestamp(remaining)} remaining</div>
      <div className="mx-auto mt-6 h-1 max-w-xs overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn('h-full origin-left rounded-full transition-transform duration-200 ease-linear', remaining <= 60 ? 'bg-warn' : 'bg-accent')} style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="mt-8">
        <Controls state={state} engine={engine} />
      </div>
      <p className="mt-6 text-xs text-white/35">{state.mode === 'tab' ? 'You can also control the recording from the bar on your tab.' : 'Controls are also on the floating bar in your tabs and in the Spool popup.'}</p>
    </div>
  );
}

function Uploading({ state }: { state: RecordingState }) {
  const upload = state.upload;
  const pct = upload && upload.queuedBytes > 0 ? Math.min(1, upload.uploadedBytes / upload.queuedBytes) : 0;
  return (
    <div className="py-4 text-center">
      <div className="relative mx-auto h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <motion.circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#00FA9A"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 44}
            animate={{ strokeDashoffset: 2 * Math.PI * 44 * (1 - Math.max(0.03, pct)) }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
            style={{ filter: 'drop-shadow(0 0 6px rgba(0,250,154,0.6))' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-white tabular">{Math.round(pct * 100)}%</span>
      </div>
      <h1 className="mt-6 text-lg font-semibold text-white">Finishing your upload</h1>
      <p className="mt-1.5 text-sm text-white/50">
        {upload && upload.queuedBytes > 0 ? `${formatBytes(upload.uploadedBytes)} of ${formatBytes(upload.queuedBytes)} · ` : ''}Your video opens as soon as it’s done.
      </p>
    </div>
  );
}

function Done() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-glow">
        <Check className="h-7 w-7" strokeWidth={3} />
      </motion.span>
      <h1 className="mt-5 text-lg font-semibold text-white">Uploaded</h1>
      <p className="mt-1.5 text-sm text-white/50">Opening your video…</p>
    </div>
  );
}

function Failure({ engine, message, canRetry, canDownload }: { engine: RecorderEngine; message: string; canRetry: boolean; canDownload: boolean }) {
  return (
    <div className="py-2 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-danger/20 bg-danger-soft text-danger">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <h1 className="mt-5 text-lg font-semibold text-white">The recording couldn’t finish</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/55">{message}</p>
      {canDownload && <p className="mx-auto mt-2 max-w-sm text-xs text-white/40">Your recording is safe in this tab until you close it.</p>}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {canRetry && (
          <Button variant="primary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void engine.retryUpload()}>
            Retry upload
          </Button>
        )}
        {canDownload && (
          <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={() => engine.downloadRecording()}>
            Download .webm
          </Button>
        )}
        <Button variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={() => void engine.closeQuietly()}>
          Close
        </Button>
      </div>
    </div>
  );
}

function CameraStage({ stream, state, elapsed, now, engine }: { stream: MediaStream | null; state: RecordingState; elapsed: number; now: number; engine: RecorderEngine }) {
  const bindVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      if (!node) return;
      if (node.srcObject !== stream) node.srcObject = stream;
      if (stream) void node.play().catch(() => undefined);
    },
    [stream],
  );
  const countdown = state.phase === 'countdown' && state.countdownEndsAt ? Math.max(1, Math.ceil((state.countdownEndsAt - now) / 1000)) : null;
  const live = state.phase === 'recording' || state.phase === 'paused';

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
      <div className="relative aspect-video overflow-hidden rounded-3xl border border-white/10 bg-ink-950 shadow-pop">
        <video ref={bindVideo} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" />
        {!stream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]">
              <AnimatePresence mode="popLayout">
                <motion.span key={countdown} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} className="text-8xl font-bold text-white tabular drop-shadow-lg">
                  {countdown}
                </motion.span>
              </AnimatePresence>
              <Button variant="secondary" size="sm" className="mt-6" onClick={() => void engine.discard()}>
                Cancel
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {live && (
          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-md">
            <span className={cn('h-2 w-2 rounded-full', state.phase === 'paused' ? 'bg-warn' : 'animate-pulse bg-[#FF3B4E]')} />
            <span className="tabular">{formatTimestamp(elapsed)}</span>
            <span className="text-white/40 tabular">/ {formatTimestamp(state.maxSeconds)}</span>
          </div>
        )}
      </div>
      <AnimatePresence>
        {live && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="mt-5">
            <Controls state={state} engine={engine} compact />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RoundButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-ink-800 text-white/75 transition-colors hover:border-white/15 hover:bg-ink-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40',
        active && 'border-danger/30 bg-danger-soft text-danger hover:text-danger',
        danger && 'hover:border-danger/30 hover:bg-danger-soft hover:text-danger',
      )}
    >
      {children}
    </motion.button>
  );
}
