import { formatTimestamp, isTimeKept, sourceToEdited, type AiStatus, type EditConfig, type Transcript } from '@spool/shared';
import { motion } from 'framer-motion';
import { Check, Copy, Download, LocateFixed, Search, Sparkles, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/hooks';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';
import { EmptyState, Skeleton } from '../ui/misc';
import { Tooltip } from '../ui/Tooltip';

interface TranscriptPanelProps {
  transcript: Transcript | null;
  edit: EditConfig;
  aiStatus: AiStatus;
  title: string;
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-accent/25 px-0.5 text-white">{text.slice(index, index + query.length)}</mark>
      {highlight(text.slice(index + query.length), query)}
    </>
  );
}

export function TranscriptPanel({ transcript, edit, aiStatus, title }: TranscriptPanelProps) {
  const sourceTime = usePlayerStore((s) => s.sourceTime);
  const seek = usePlayerStore((s) => s.seek);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const programmaticScroll = useRef(false);

  const segments = useMemo(
    () => (transcript?.segments ?? []).filter((s) => isTimeKept(edit, s.start + 0.05) || isTimeKept(edit, (s.start + s.end) / 2)),
    [transcript, edit],
  );
  const filtered = useMemo(
    () => (query.trim() ? segments.filter((s) => s.text.toLowerCase().includes(query.trim().toLowerCase())) : segments),
    [segments, query],
  );
  const activeId = segments.find((s) => sourceTime >= s.start && sourceTime < s.end + 0.3)?.id ?? null;

  useEffect(() => {
    if (!follow || query || activeId === null) return;
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    const top = active.offsetTop - list.clientHeight * 0.32;
    programmaticScroll.current = true;
    list.scrollTo({ top, behavior: 'smooth' });
    const timer = window.setTimeout(() => {
      programmaticScroll.current = false;
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeId, follow, query]);

  const copyAll = async () => {
    const text = segments.map((s) => `[${formatTimestamp(sourceToEdited(edit, s.start))}] ${s.text}`).join('\n');
    if (!(await copyText(text, 'Transcript copied'))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const downloadSrt = () => {
    const body = segments
      .map((s, i) => `${i + 1}\n${srtTime(sourceToEdited(edit, s.start))} --> ${srtTime(sourceToEdited(edit, s.end))}\n${s.text}\n`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'application/x-subrip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[^\w\s-]/g, '').trim() || 'transcript'}.srt`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Subtitles downloaded');
  };

  if (!transcript) {
    if (aiStatus === 'pending' || aiStatus === 'processing') {
      return (
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Sparkles className="h-4 w-4 animate-pulse text-accent" />
            Transcribing with word-level timestamps…
          </div>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-4 w-10" />
              <Skeleton className={cn('h-4', i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-full' : 'w-2/3')} />
            </div>
          ))}
        </div>
      );
    }
    return (
      <EmptyState
        icon={<Sparkles className="h-6 w-6" />}
        title={aiStatus === 'failed' ? 'Transcription failed' : 'Transcript unavailable'}
        description={
          aiStatus === 'failed'
            ? 'The transcription provider returned an error. The creator can retry from the video menu.'
            : 'Transcription is not configured on this Spool server.'
        }
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pl-8 pr-7 text-[13px] text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Tooltip content={follow ? 'Following playback' : 'Follow playback'}>
          <button
            onClick={() => setFollow(true)}
            className={cn('rounded-lg p-2 transition hover:bg-white/5', follow ? 'text-accent' : 'text-white/45 hover:text-white')}
            aria-label="Follow playback"
          >
            <LocateFixed className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={copied ? 'Copied' : 'Copy transcript'}>
          <button onClick={copyAll} className="rounded-lg p-2 text-white/45 transition hover:bg-white/5 hover:text-white" aria-label="Copy transcript">
            {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
          </button>
        </Tooltip>
        <Tooltip content="Download .srt">
          <button onClick={downloadSrt} className="rounded-lg p-2 text-white/45 transition hover:bg-white/5 hover:text-white" aria-label="Download subtitles">
            <Download className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div
        ref={listRef}
        className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3"
        onWheel={() => !programmaticScroll.current && setFollow(false)}
        onTouchMove={() => setFollow(false)}
      >
        {filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-white/40">No lines match “{query}”.</p>}
        {filtered.map((segment) => {
          const active = segment.id === activeId;
          return (
            <div
              key={segment.id}
              ref={active ? activeRef : undefined}
              onClick={() => seek(segment.start)}
              className={cn(
                'group relative flex cursor-pointer gap-3 rounded-xl px-3 py-2 transition-colors',
                active ? 'bg-accent/[0.07]' : 'hover:bg-white/[0.035]',
              )}
            >
              {active && (
                <motion.span
                  layoutId="transcript-active"
                  className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(0,250,154,0.9)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <span className={cn('w-11 shrink-0 pt-px font-mono text-2xs tabular', active ? 'text-accent' : 'text-white/35 group-hover:text-white/60')}>
                {formatTimestamp(sourceToEdited(edit, segment.start))}
              </span>
              <p className={cn('text-[13.5px] leading-relaxed', active ? 'text-white' : 'text-white/65')}>
                {active && segment.words.length > 0 && !query
                  ? segment.words.map((word, i) => {
                      const spoken = sourceTime >= word.start;
                      const current = sourceTime >= word.start && sourceTime < word.end + 0.08;
                      return (
                        <Fragment key={`${word.start}-${i}`}>
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              seek(word.start);
                            }}
                            className={cn(
                              'rounded-[4px] transition-colors duration-100',
                              current ? 'bg-accent/25 text-white' : spoken ? 'text-white' : 'text-white/50',
                            )}
                          >
                            {word.word}
                          </span>{' '}
                        </Fragment>
                      );
                    })
                  : highlight(segment.text, query.trim())}
              </p>
            </div>
          );
        })}
      </div>
      {!follow && !query && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setFollow(true)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-700/90 px-3 py-1.5 text-xs font-medium text-white shadow-pop backdrop-blur"
          >
            <LocateFixed className="h-3.5 w-3.5 text-accent" /> Resume follow
          </motion.button>
        </div>
      )}
    </div>
  );
}
