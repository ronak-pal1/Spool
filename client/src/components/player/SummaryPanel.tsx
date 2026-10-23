import { formatTimestamp, sourceToEdited, type AiStatus, type EditConfig, type VideoSummary } from '@spool/shared';
import { motion, type Variants } from 'framer-motion';
import { CheckSquare, ListChecks, Lightbulb, RefreshCw, Sparkles, Square } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { usePlayerStore } from '@/store/player.store';
import { Button } from '../ui/Button';
import { Badge, EmptyState, Skeleton } from '../ui/misc';

interface SummaryPanelProps {
  summary: VideoSummary | null;
  edit: EditConfig;
  aiStatus: AiStatus;
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item: Variants = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34 } } };

function TimeChip({ seconds, edit }: { seconds: number; edit: EditConfig }) {
  const seek = usePlayerStore((s) => s.seek);
  return (
    <button
      onClick={() => seek(seconds)}
      className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-px font-mono text-2xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/20"
    >
      {formatTimestamp(sourceToEdited(edit, seconds))}
    </button>
  );
}

export function SummaryPanel({ summary, edit, aiStatus, canRegenerate, regenerating, onRegenerate }: SummaryPanelProps) {
  const sourceTime = usePlayerStore((s) => s.sourceTime);
  const seek = usePlayerStore((s) => s.seek);
  const [done, setDone] = useState<Set<number>>(new Set());

  if (!summary) {
    if (aiStatus === 'pending' || aiStatus === 'processing') {
      return (
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Sparkles className="h-4 w-4 animate-pulse text-accent" /> Writing summary, chapters and action items…
          </div>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    return (
      <EmptyState
        icon={<Sparkles className="h-6 w-6" />}
        title={aiStatus === 'failed' ? 'Summary failed' : 'No AI summary'}
        description={
          aiStatus === 'unavailable'
            ? 'AI features are not configured on this Spool server.'
            : aiStatus === 'failed'
              ? 'Something went wrong while generating notes for this video.'
              : 'This video has no speech to summarize.'
        }
        action={
          canRegenerate && aiStatus !== 'unavailable' ? (
            <Button size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} loading={regenerating} onClick={onRegenerate}>
              Retry AI processing
            </Button>
          ) : undefined
        }
      />
    );
  }

  const activeChapter = [...summary.chapters].reverse().find((c) => sourceTime >= c.start);

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="h-full space-y-6 overflow-y-auto p-5">
      <motion.section variants={item} className="relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[0.09] via-transparent to-transparent p-4">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/20 blur-3xl" />
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
            <Sparkles className="h-3.5 w-3.5" /> TL;DR
          </span>
          {canRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="flex items-center gap-1 text-2xs text-white/40 transition hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', regenerating && 'animate-spin')} /> Regenerate
            </button>
          )}
        </div>
        <p className="text-[14px] leading-relaxed text-white/85">{summary.tldr}</p>
        {summary.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.topics.map((topic) => (
              <Badge key={topic}>{topic}</Badge>
            ))}
          </div>
        )}
      </motion.section>

      {summary.takeaways.length > 0 && (
        <motion.section variants={item}>
          <h3 className="label mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> Key takeaways
          </h3>
          <ul className="space-y-2.5">
            {summary.takeaways.map((takeaway, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-white/75">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgba(0,250,154,0.9)]" />
                {takeaway}
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {summary.actionItems.length > 0 && (
        <motion.section variants={item}>
          <h3 className="label mb-3 flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Action items
          </h3>
          <ul className="space-y-1.5">
            {summary.actionItems.map((action, i) => {
              const checked = done.has(i);
              return (
                <li key={i} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <button
                    onClick={() =>
                      setDone((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    className="mt-0.5 text-white/40 transition hover:text-accent"
                    aria-label={checked ? 'Mark as not done' : 'Mark as done'}
                  >
                    {checked ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13.5px] leading-snug transition', checked ? 'text-white/35 line-through' : 'text-white/80')}>{action.text}</p>
                    {(action.owner || action.timestamp !== null) && (
                      <div className="mt-1.5 flex items-center gap-2">
                        {action.timestamp !== null && <TimeChip seconds={action.timestamp} edit={edit} />}
                        {action.owner && <span className="text-2xs text-white/40">@{action.owner}</span>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </motion.section>
      )}

      {summary.chapters.length > 0 && (
        <motion.section variants={item}>
          <h3 className="label mb-3">Chapters</h3>
          <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[19px] before:top-3 before:w-px before:bg-white/[0.08]">
            {summary.chapters.map((chapter) => {
              const active = activeChapter === chapter;
              return (
                <li key={`${chapter.start}-${chapter.title}`}>
                  <button
                    onClick={() => seek(chapter.start)}
                    className={cn('relative flex w-full gap-3 rounded-xl px-2 py-2 text-left transition', active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]')}
                  >
                    <span
                      className={cn(
                        'relative z-10 mt-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition',
                        active ? 'border-accent bg-accent text-accent-foreground shadow-glow' : 'border-white/15 bg-ink-850 text-white/45',
                      )}
                    >
                      {summary.chapters.indexOf(chapter) + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate text-[13.5px] font-medium', active ? 'text-white' : 'text-white/80')}>{chapter.title}</span>
                        <span className="font-mono text-2xs text-white/35">{formatTimestamp(sourceToEdited(edit, chapter.start))}</span>
                      </span>
                      {chapter.summary && <span className="mt-0.5 block text-xs leading-relaxed text-white/45">{chapter.summary}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </motion.section>
      )}
    </motion.div>
  );
}
