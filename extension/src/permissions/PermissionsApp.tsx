import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, Lock, Mic, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { describeMediaError, queryPermission, stopStream, type PermissionValue } from '@/lib/media';
import { cn } from '@/ui/cn';
import { Button, Logo, spring } from '@/ui/primitives';

type Kind = 'microphone' | 'camera';

export function PermissionsApp() {
  const [status, setStatus] = useState<Record<Kind, PermissionValue>>({ microphone: 'prompt', camera: 'prompt' });
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [microphone, camera] = await Promise.all([queryPermission('microphone'), queryPermission('camera')]);
    setStatus({ microphone, camera });
  }, []);

  useEffect(() => {
    document.title = 'Spool · Allow camera & microphone';
    void refresh();
    const statuses: PermissionStatus[] = [];
    for (const name of ['microphone', 'camera'] as const) {
      navigator.permissions
        .query({ name: name as PermissionName })
        .then((permission) => {
          permission.onchange = () => void refresh();
          statuses.push(permission);
        })
        .catch(() => undefined);
    }
    return () => statuses.forEach((permission) => (permission.onchange = null));
  }, [refresh]);

  const request = async () => {
    setRequesting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stopStream(stream);
    } catch (combinedError) {
      // Machines without a camera (or mic) reject the combined request; ask for each one separately.
      const results = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stopStream),
        navigator.mediaDevices.getUserMedia({ video: true }).then(stopStream),
      ]);
      if (results.every((result) => result.status === 'rejected')) setError(describeMediaError(combinedError));
    } finally {
      await refresh();
      setRequesting(false);
    }
  };

  const allGranted = status.microphone === 'granted' && status.camera === 'granted';
  const anyDenied = status.microphone === 'denied' || status.camera === 'denied';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-accent-radial" />
      <header className="relative px-8 py-6">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-6 pb-20">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="surface glass w-full max-w-md p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-glow">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-white">{allGranted ? 'You’re all set' : 'Allow camera & microphone'}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            {allGranted
              ? 'Spool can now record your voice and show your camera bubble. You can close this tab and start recording from the toolbar.'
              : 'Spool uses your microphone for narration and your camera for the floating bubble. Access is only used while you record.'}
          </p>

          <div className="mt-6 space-y-2">
            <PermissionRow icon={<Mic className="h-4 w-4" />} label="Microphone" status={status.microphone} />
            <PermissionRow icon={<Camera className="h-4 w-4" />} label="Camera" status={status.camera} />
          </div>

          <AnimatePresence>
            {(error || anyDenied) && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="mt-4 flex gap-3 rounded-xl border border-warn/20 bg-warn-soft p-3 text-[13px] leading-relaxed text-white/75">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                  <span>
                    {anyDenied
                      ? 'Access was blocked. Click the camera icon at the right of the address bar (or the lock icon), choose “Allow”, then come back here.'
                      : error}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-7">
            {allGranted ? (
              <Button variant="primary" size="lg" className="w-full" onClick={() => window.close()}>
                Close this tab
              </Button>
            ) : (
              <Button variant="primary" size="lg" className="w-full" loading={requesting} onClick={() => void request()}>
                Allow access
              </Button>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}

function PermissionRow({ icon, label, status }: { icon: ReactNode; label: string; status: PermissionValue }) {
  const granted = status === 'granted';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-ink-950/50 px-3.5 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-ink-800 text-white/60">{icon}</span>
      <span className="flex-1 text-sm font-medium text-white">{label}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={spring}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            granted ? 'bg-accent/15 text-accent' : status === 'denied' ? 'bg-danger-soft text-danger' : 'bg-white/[0.06] text-white/50',
          )}
        >
          {granted && <Check className="h-3 w-3" strokeWidth={3} />}
          {granted ? 'Allowed' : status === 'denied' ? 'Blocked' : 'Not yet'}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
