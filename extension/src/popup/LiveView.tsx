import { formatBytes, formatTimestamp } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, Mic, MicOff, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNow } from '@/lib/hooks';
import { notify, sendCommand } from '@/lib/messages';
import { elapsedMs, resetRecordingState, type RecordingState } from '@/lib/state';
import { cn } from '@/ui/cn';
import { Button, Logo, Spinner } from '@/ui/primitives';

const PHASE_LABEL: Record<RecordingState['phase'], string> = {
  idle: 'Idle',
  preparing: 'Getting ready',
  countdown: 'Starting',
  recording: 'Recording',
  paused: 'Paused',
  finalizing: 'Uploading',
  error: 'Needs attention',
};

async function recorderExists(state: RecordingState): Promise<boolean> {
  if (state.recorderTabId === null) return false;
  try {
    await chrome.tabs.get(state.recorderTabId);
    return true;
  } catch {
    return false;
  }
}

export function LiveView({ state }: { state: RecordingState }) {
  const capturing = state.phase === 'recording' || state.phase === 'paused';
  const now = useNow(state.phase === 'recording' || state.phase === 'countdown');
  const elapsed = elapsedMs(state, now) / 1000;
  const remaining = Math.max(0, state.maxSeconds - elapsed);
  const progress = Math.min(1, elapsed / Math.max(1, state.maxSeconds));
  const [confirm, setConfirm] = useState<'restart' | 'discard' | null>(null);

  const dismiss = async () => {
    if (!(await recorderExists(state))) {
      await resetRecordingState();
      return;
    }
    // While preparing, the recorder may still be loading and not yet listening; closing its tab cancels cleanly.
    if (state.phase === 'preparing' && state.recorderTabId !== null) await chrome.tabs.remove(state.recorderTabId);
    else sendCommand('discard');
  };

  const focusRecorder = () => {
    notify({ type: 'spool:focus-recorder' });
    window.close();
  };

  const upload = state.upload;
  const uploadPct = upload && upload.queuedBytes > 0 ? Math.min(1, upload.uploadedBytes / upload.queuedBytes) : 0;

  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex items-center justify-between">
        <Logo />
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold',
            state.phase === 'recording' && 'border-[#FF3B4E]/30 bg-[#FF3B4E]/10 text-[#FF6B7A]',
            state.phase === 'paused' && 'border-warn/30 bg-warn-soft text-warn',
            state.phase === 'error' && 'border-danger/30 bg-danger-soft text-danger',
            !['recording', 'paused', 'error'].includes(state.phase) && 'border-white/10 bg-white/[0.05] text-white/70',
          )}
        >
          <span className="relative flex h-1.5 w-1.5">
            {state.phase === 'recording' && <span className="absolute inset-0 animate-ping rounded-full bg-[#FF3B4E]" />}
            <span className={cn('relative h-1.5 w-1.5 rounded-full', state.phase === 'recording' ? 'bg-[#FF3B4E]' : state.phase === 'paused' ? 'bg-warn' : 'bg-current')} />
          </span>
          {PHASE_LABEL[state.phase]}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {state.phase === 'error' ? (
          <motion.div key="error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-danger/20 bg-danger-soft text-danger">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-[15px] font-semibold text-white">Something went wrong</h2>
            <p className="mx-auto mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-white/55">{state.error ?? 'The recording could not continue.'}</p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void dismiss()}>
                Dismiss
              </Button>
              <Button variant="primary" onClick={focusRecorder} leftIcon={<ExternalLink className="h-4 w-4" />}>
                Open recorder
              </Button>
            </div>
          </motion.div>
        ) : state.phase === 'preparing' || state.phase === 'countdown' ? (
          <motion.div key="prep" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-10 flex flex-col items-center text-center">
            <Spinner className="h-8 w-8" />
            <h2 className="mt-5 text-[15px] font-semibold text-white">
              {state.phase === 'countdown' ? 'Recording starts in a moment' : state.mode === 'screen' ? 'Choose what to share' : 'Preparing capture'}
            </h2>
            <p className="mt-1.5 max-w-[260px] text-[12.5px] text-white/50">
              {state.phase === 'countdown' ? 'Get ready — the countdown is running on your page.' : 'Spool opened a pinned recorder tab to capture your recording.'}
            </p>
            <Button variant="ghost" className="mt-6" onClick={() => void dismiss()}>
              Cancel
            </Button>
          </motion.div>
        ) : state.phase === 'finalizing' ? (
          <motion.div key="upload" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-10 text-center">
            <div className="text-[34px] font-semibold tracking-tight text-white tabular">{Math.round(uploadPct * 100)}%</div>
            <p className="mt-1 text-[12.5px] text-white/50">
              Finishing upload{upload && upload.queuedBytes > 0 ? ` · ${formatBytes(upload.uploadedBytes)} of ${formatBytes(upload.queuedBytes)}` : ''}
            </p>
            <div className="mx-auto mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div className="h-full rounded-full bg-accent shadow-[0_0_12px_rgba(0,250,154,0.7)]" animate={{ width: `${Math.max(4, uploadPct * 100)}%` }} transition={{ ease: 'easeOut' }} />
            </div>
            <p className="mt-5 text-[11.5px] text-white/35">Your video opens automatically when it’s ready.</p>
          </motion.div>
        ) : (
          <motion.div key="live" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-7">
            <div className="text-center">
              <div className={cn('text-[46px] font-semibold leading-none tracking-tight tabular', remaining <= 15 ? 'text-danger' : remaining <= 60 ? 'text-warn' : 'text-white', state.phase === 'paused' && 'animate-pulse')}>
                {formatTimestamp(elapsed)}
              </div>
              <div className="mt-2 text-[12px] text-white/40 tabular">{formatTimestamp(remaining)} left of {formatTimestamp(state.maxSeconds)}</div>
            </div>
            <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn('h-full origin-left rounded-full transition-transform duration-300 ease-linear', remaining <= 15 ? 'bg-danger' : remaining <= 60 ? 'bg-warn' : 'bg-accent')}
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>

            <div className="mt-6 grid grid-cols-4 gap-2">
              <ControlButton label={state.phase === 'paused' ? 'Resume' : 'Pause'} onClick={() => sendCommand('toggle-pause')} disabled={!capturing}>
                {state.phase === 'paused' ? <Play className="h-[18px] w-[18px]" /> : <Pause className="h-[18px] w-[18px]" />}
              </ControlButton>
              <ControlButton
                label={!state.micEnabled ? 'No mic' : state.micMuted ? 'Unmute' : 'Mute'}
                onClick={() => sendCommand('toggle-mic')}
                disabled={!state.micEnabled}
                tone={state.micMuted ? 'danger' : undefined}
              >
                {state.micMuted || !state.micEnabled ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
              </ControlButton>
              <ControlButton label="Restart" onClick={() => setConfirm('restart')}>
                <RotateCcw className="h-[18px] w-[18px]" />
              </ControlButton>
              <ControlButton label="Discard" onClick={() => setConfirm('discard')} tone="danger-hover">
                <Trash2 className="h-[18px] w-[18px]" />
              </ControlButton>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {confirm ? (
                <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
                  <p className="text-[12.5px] text-white/75">{confirm === 'restart' ? 'Start over? The current take will be deleted.' : 'Discard this recording? This can’t be undone.'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Keep recording
                    </Button>
                    <Button
                      size="sm"
                      variant={confirm === 'discard' ? 'danger' : 'secondary'}
                      onClick={() => {
                        sendCommand(confirm);
                        setConfirm(null);
                        if (confirm === 'discard') window.close();
                      }}
                    >
                      {confirm === 'restart' ? 'Restart' : 'Discard'}
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="stop" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                  <Button
                    variant="primary"
                    size="lg"
                    className="mt-3 w-full"
                    leftIcon={<Square className="h-3.5 w-3.5 fill-current" />}
                    onClick={() => {
                      sendCommand('stop');
                    }}
                  >
                    Stop & share
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <button type="button" onClick={focusRecorder} className="mx-auto mt-3 flex items-center gap-1.5 text-[11.5px] text-white/35 transition-colors hover:text-white/70">
              <ExternalLink className="h-3 w-3" />
              Open recorder tab
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger' | 'danger-hover';
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-[62px] flex-col items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] bg-ink-850 text-white/75 transition-colors hover:border-white/15 hover:bg-ink-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'danger' && 'border-danger/25 bg-danger-soft text-danger hover:text-danger',
        tone === 'danger-hover' && 'hover:border-danger/25 hover:bg-danger-soft hover:text-danger',
      )}
    >
      {children}
      <span className="text-[11px] font-medium">{label}</span>
    </motion.button>
  );
}
