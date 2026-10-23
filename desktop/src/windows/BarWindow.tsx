import { Camera, Mic, MicOff, Pause, Pencil, Play, RotateCcw, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { errorMessage, recorder, startDragging, useRecording } from '../lib/bridge';
import { cn } from '../lib/cn';

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function BarWindow() {
  const snapshot = useRecording();
  const [notice, setNotice] = useState<string | null>(null);
  const [armedDiscard, setArmedDiscard] = useState(false);
  const remaining = snapshot.limitMs - snapshot.elapsedMs;
  const urgent = snapshot.phase === 'recording' && remaining < 30_000;
  const paused = snapshot.phase === 'paused';

  useEffect(() => {
    if (!armedDiscard) return;
    const timer = window.setTimeout(() => setArmedDiscard(false), 1800);
    return () => window.clearTimeout(timer);
  }, [armedDiscard]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setNotice(null);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  return (
    <div className="flex h-full items-center px-2 py-2">
      <div className="glass flex h-full w-full items-center gap-1.5 rounded-full px-2 shadow-pop">
        <button type="button" onMouseDown={() => void startDragging()} className="flex min-w-[92px] cursor-grab items-center gap-2 px-2 active:cursor-grabbing">
          <span className={cn('h-2.5 w-2.5 rounded-full', snapshot.phase === 'paused' ? 'bg-warn' : snapshot.phase === 'finalizing' ? 'bg-white/70' : 'bg-danger shadow-[0_0_10px_rgba(255,92,108,0.8)]')} />
          <span className={cn('font-mono text-sm tabular-nums', urgent ? 'text-danger' : 'text-white')}>
            {snapshot.phase === 'countdown' ? snapshot.countdown ?? 3 : snapshot.phase === 'finalizing' ? `${Math.round(snapshot.progress * 100)}%` : clock(snapshot.elapsedMs)}
          </span>
        </button>
        {snapshot.phase === 'countdown' ? (
          <span className="px-2 text-sm text-white/60">Get ready</span>
        ) : snapshot.phase === 'finalizing' ? (
          <div className="mx-2 h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(snapshot.progress * 100)}%` }} />
          </div>
        ) : (
          <>
            <IconButton label={paused ? 'Resume' : 'Pause'} onClick={() => void run(paused ? recorder.resume : recorder.pause)}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </IconButton>
            <IconButton label="Stop" onClick={() => void run(recorder.stop)}>
              <Square size={15} fill="currentColor" />
            </IconButton>
            <IconButton
              label={snapshot.micMuted ? 'Unmute microphone' : 'Mute microphone'}
              disabled={!snapshot.micAttached}
              onClick={() => void run(() => recorder.setMicMuted(!snapshot.micMuted))}
            >
              {snapshot.micMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </IconButton>
            <IconButton
              label={snapshot.systemMuted ? 'Unmute system audio' : 'Mute system audio'}
              disabled={!snapshot.systemAttached}
              onClick={() => void run(() => recorder.setSystemMuted(!snapshot.systemMuted))}
            >
              {snapshot.systemMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
            <IconButton label="Draw" pressed={snapshot.drawEnabled} onClick={() => void run(() => recorder.setDrawEnabled(!snapshot.drawEnabled))}>
              <Pencil size={16} />
            </IconButton>
            {snapshot.cameraEnabled ? (
              <IconButton
                label="Camera click-through"
                pressed={snapshot.cameraClickThrough}
                onClick={() => void run(() => recorder.setCameraClickThrough(!snapshot.cameraClickThrough))}
              >
                <Camera size={16} />
              </IconButton>
            ) : null}
            <IconButton label="Restart" onClick={() => void run(recorder.restart)}>
              <RotateCcw size={16} />
            </IconButton>
            <IconButton
              label={armedDiscard ? 'Confirm discard' : 'Discard'}
              danger={armedDiscard}
              onClick={() => {
                if (!armedDiscard) {
                  setArmedDiscard(true);
                  return;
                }
                setArmedDiscard(false);
                void run(recorder.discard);
              }}
            >
              <Trash2 size={16} />
            </IconButton>
          </>
        )}
        {snapshot.phase === 'countdown' ? (
          <IconButton label="Cancel" onClick={() => void run(recorder.discard)}>
            <Trash2 size={16} />
          </IconButton>
        ) : null}
        {notice ? <span className="truncate pr-3 text-xs text-danger">{notice}</span> : null}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  pressed,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 disabled:opacity-30',
        pressed && 'bg-accent/15 text-accent',
        danger && 'bg-danger/20 text-danger',
      )}
    >
      {children}
    </button>
  );
}
