import { formatTimestamp, type StoryboardMeta } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface ScrubberChapter {
  title: string;
  /** Edited-timeline start in seconds. */
  start: number;
}

interface ScrubberProps {
  duration: number;
  current: number;
  buffered: number;
  chapters: ScrubberChapter[];
  storyboard: StoryboardMeta | null;
  toSource: (edited: number) => number;
  onSeek: (edited: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

/** Edited-timeline progress bar with chapter gaps and storyboard hover previews. */
export function Scrubber({ duration, current, buffered, chapters, storyboard, toSource, onSeek, onScrubStart, onScrubEnd }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return { x: 0, time: 0 };
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return { x, time: (x / rect.width) * duration };
  };

  const segments = (chapters.length > 1 ? chapters : [{ title: '', start: 0 }]).map((chapter, i, all) => ({
    ...chapter,
    end: all[i + 1]?.start ?? duration,
  }));

  const hoverChapter = hover ? segments.find((s) => hover.time >= s.start && hover.time < s.end) : null;
  const frameIndex =
    hover && storyboard ? Math.min(storyboard.frames - 1, Math.max(0, Math.floor(toSource(hover.time) / storyboard.interval))) : 0;
  const previewWidth = storyboard ? 176 : 0;
  const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 0;
  const previewLeft = hover ? Math.min(Math.max(hover.x - previewWidth / 2, 0), Math.max(0, trackWidth - previewWidth)) : 0;

  return (
    <div
      ref={trackRef}
      className="group/scrub relative flex h-5 cursor-pointer touch-none items-center"
      onPointerMove={(event) => {
        const point = timeAt(event.clientX);
        setHover(point);
        if (dragging) onSeek(point.time);
      }}
      onPointerLeave={() => !dragging && setHover(null)}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        setDragging(true);
        onScrubStart?.();
        onSeek(timeAt(event.clientX).time);
      }}
      onPointerUp={(event) => {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        setDragging(false);
        setHover(null);
        onScrubEnd?.();
      }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
    >
      <div className="absolute inset-x-0 flex h-full items-center gap-[3px]">
        {segments.map((segment) => {
          const width = duration > 0 ? ((segment.end - segment.start) / duration) * 100 : 100;
          const played = Math.min(Math.max((current - segment.start) / Math.max(segment.end - segment.start, 0.001), 0), 1);
          const loaded = Math.min(Math.max((buffered - segment.start) / Math.max(segment.end - segment.start, 0.001), 0), 1);
          const isHovered = hoverChapter === segment;
          return (
            <div
              key={`${segment.start}-${segment.title}`}
              style={{ width: `${width}%` }}
              className={cn(
                'relative h-1 overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/scrub:h-1.5',
                isHovered && 'group-hover/scrub:h-2',
              )}
            >
              <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${loaded * 100}%` }} />
              <div
                className="absolute inset-y-0 left-0 bg-accent shadow-[0_0_10px_rgba(0,250,154,0.9)]"
                style={{ width: `${played * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 scale-0 rounded-full bg-white shadow-[0_0_0_4px_rgba(0,250,154,0.35)] transition-transform duration-150 group-hover/scrub:scale-100"
        style={{ left: `${duration > 0 ? (current / duration) * 100 : 0}%` }}
      />
      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="pointer-events-none absolute bottom-7"
            style={{ left: storyboard ? previewLeft : hover.x, transform: storyboard ? undefined : 'translateX(-50%)' }}
          >
          <motion.div
            initial={{ y: 6, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 38 }}
            className="flex flex-col items-center"
          >
            {storyboard && (
              <div
                className="overflow-hidden rounded-lg border border-white/15 bg-ink-900 shadow-pop"
                style={{
                  width: previewWidth,
                  height: (previewWidth * storyboard.frameHeight) / storyboard.frameWidth,
                  backgroundImage: `url(${storyboard.url})`,
                  backgroundSize: `${storyboard.frames * previewWidth}px 100%`,
                  backgroundPosition: `-${frameIndex * previewWidth}px 0`,
                }}
              />
            )}
            <div className="mt-1.5 flex max-w-[200px] flex-col items-center rounded-md bg-ink-900/90 px-2 py-1 text-center backdrop-blur">
              {hoverChapter?.title && <span className="truncate text-2xs font-medium text-white/80">{hoverChapter.title}</span>}
              <span className="font-mono text-2xs text-white">{formatTimestamp(hover.time)}</span>
            </div>
          </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
