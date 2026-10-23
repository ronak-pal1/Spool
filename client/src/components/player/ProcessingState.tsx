import type { PipelineStage, VideoStatus } from '@spool/shared';
import { motion } from 'framer-motion';
import { AlertTriangle, AudioLines, Check, CloudUpload, Film, RefreshCw, ScanSearch, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '../ui/Button';

const STEPS: { stage: PipelineStage; label: string; icon: ReactNode }[] = [
  { stage: 'uploading', label: 'Upload', icon: <CloudUpload className="h-4 w-4" /> },
  { stage: 'transcoding', label: 'Optimize', icon: <Film className="h-4 w-4" /> },
  { stage: 'transcribing', label: 'Transcribe', icon: <AudioLines className="h-4 w-4" /> },
  { stage: 'summarizing', label: 'Summarize', icon: <Sparkles className="h-4 w-4" /> },
  { stage: 'indexing', label: 'Index', icon: <ScanSearch className="h-4 w-4" /> },
];

const ORDER: Record<PipelineStage, number> = {
  uploading: 0,
  queued: 1,
  transcoding: 1,
  transcribing: 2,
  summarizing: 3,
  indexing: 4,
  complete: 5,
  failed: -1,
};

const HEADLINE: Record<PipelineStage, string> = {
  uploading: 'Waiting for the upload to finish',
  queued: 'Queued for processing',
  transcoding: 'Optimizing video for fast playback',
  transcribing: 'Transcribing every word',
  summarizing: 'Writing the summary and chapters',
  indexing: 'Indexing for search',
  complete: 'Ready',
  failed: 'Processing failed',
};

interface ProcessingStateProps {
  status: VideoStatus;
  stage: PipelineStage;
  error: string | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  aspect: number;
  poster?: string | null;
}

export function ProcessingState({ status, stage, error, canRetry, retrying, onRetry, aspect, poster }: ProcessingStateProps) {
  const failed = status === 'failed';
  const current = ORDER[stage];

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-850 shadow-card"
      style={{ aspectRatio: `${aspect > 0 ? aspect : 16 / 9}`, maxHeight: '72vh' }}
    >
      {poster && <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />}
      <div className="absolute inset-0 bg-accent-radial opacity-60" />
      <div className="absolute inset-0 bg-grid-fade bg-[size:36px_36px] [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]" />

      <div className="relative flex h-full flex-col items-center justify-center gap-7 p-6 text-center">
        {failed ? (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">We couldn't process this video</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-white/50">{error ?? 'The file may be corrupted or in an unsupported format.'}</p>
            </div>
            {canRetry && (
              <Button variant="secondary" onClick={onRetry} loading={retrying} leftIcon={<RefreshCw className="h-4 w-4" />}>
                Retry processing
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent/40" />
              <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent/30 [animation-delay:0.8s]" />
              <span className="absolute inset-2 animate-spin-slow rounded-full border-2 border-white/5 border-t-accent" />
              <span className="relative text-accent">{STEPS[Math.max(0, Math.min(STEPS.length - 1, current))]?.icon}</span>
            </div>
            <div>
              <motion.p key={stage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-lg font-semibold text-white">
                {HEADLINE[stage]}
              </motion.p>
              <p className="mt-1.5 text-sm text-white/45">This page updates automatically — feel free to share the link already.</p>
            </div>
            <ol className="flex items-center gap-1.5 sm:gap-2">
              {STEPS.map((step, index) => {
                const done = current > index;
                const active = current === index;
                return (
                  <li key={step.stage} className="flex items-center gap-1.5 sm:gap-2">
                    <div className="flex flex-col items-center gap-2">
                      <motion.span
                        initial={false}
                        animate={{ scale: active ? 1.08 : 1 }}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-500',
                          done && 'border-accent/40 bg-accent/15 text-accent',
                          active && 'border-accent/60 bg-accent/10 text-accent shadow-glow',
                          !done && !active && 'border-white/10 bg-white/[0.03] text-white/30',
                        )}
                      >
                        {done ? <Check className="h-4 w-4" /> : step.icon}
                      </motion.span>
                      <span className={cn('hidden text-2xs font-medium sm:block', done || active ? 'text-white/75' : 'text-white/30')}>{step.label}</span>
                    </div>
                    {index < STEPS.length - 1 && (
                      <span className="relative mb-0 h-px w-5 overflow-hidden bg-white/10 sm:mb-6 sm:w-10">
                        <motion.span
                          className="absolute inset-y-0 left-0 bg-accent"
                          initial={false}
                          animate={{ width: done ? '100%' : '0%' }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
