import { formatBytes } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, ExternalLink, UploadCloud, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUploadsStore } from '@/store/uploads.store';

/** Floating progress tray for in-flight multipart uploads. */
export function UploadTray() {
  const uploads = useUploadsStore((s) => s.uploads);
  const cancel = useUploadsStore((s) => s.cancel);
  const dismiss = useUploadsStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {uploads.map((upload) => (
          <motion.div
            key={upload.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="pointer-events-auto overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 shadow-pop backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                {upload.state === 'done' ? (
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                ) : upload.state === 'error' ? (
                  <AlertCircle className="h-4 w-4 text-danger" />
                ) : (
                  <UploadCloud className="h-4 w-4 animate-pulse text-accent" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-white">{upload.name}</p>
                <p className="truncate text-2xs text-white/45">
                  {upload.state === 'preparing' && 'Preparing upload…'}
                  {upload.state === 'uploading' && `${Math.round(upload.progress * 100)}% · ${formatBytes(upload.size)}`}
                  {upload.state === 'finalizing' && 'Finalizing…'}
                  {upload.state === 'done' && 'Uploaded — processing'}
                  {upload.state === 'error' && (upload.error ?? 'Upload failed')}
                </p>
              </div>
              {upload.state === 'done' && upload.shareId ? (
                <Link to={`/s/${upload.shareId}`} className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Open">
                  <ExternalLink className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  onClick={() => (upload.state === 'error' ? dismiss(upload.id) : cancel(upload.id))}
                  className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/5 hover:text-white"
                  aria-label={upload.state === 'error' ? 'Dismiss' : 'Cancel upload'}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {upload.state !== 'done' && upload.state !== 'error' && (
              <div className="h-[3px] bg-white/[0.05]">
                <motion.div
                  className="h-full bg-accent shadow-[0_0_12px_rgba(0,250,154,0.8)]"
                  animate={{ width: `${Math.max(3, upload.progress * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                />
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Full-window drop target shown while dragging video files over the app. */
export function DropOverlay() {
  const uploadFile = useUploadsStore((s) => s.uploadFile);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setActive(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setActive(false);
      for (const file of Array.from(event.dataTransfer?.files ?? [])) uploadFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [uploadFile]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[85] flex items-center justify-center bg-ink-900/80 p-8 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-accent/50 bg-accent/[0.03] shadow-[inset_0_0_120px_rgba(0,250,154,0.08)]"
          >
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
              <UploadCloud className="h-12 w-12 text-accent" />
            </motion.div>
            <p className="mt-4 text-lg font-semibold text-white">Drop to upload</p>
            <p className="mt-1 text-sm text-white/50">MP4, MOV, WebM or MKV — we'll transcribe and summarize it automatically.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
