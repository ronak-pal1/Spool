import { splitSegments, type ClickEvent, type StoryboardMeta } from '@spool/shared';
import { Film, ScanSearch, Scissors, SquareDashed } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useEditorStore } from '@/store/editor.store';
import { usePlayerStore } from '@/store/player.store';
import { clamp, formatPrecise, formatRulerLabel, snap, tickStep } from './timeline-math';

const PAD = 14;
const VIDEO_TRACK_HEIGHT = 64;
const MIN_ITEM_SECONDS = 0.3;
const SNAP_PX = 7;

interface TimelineProps {
  duration: number;
  storyboard: StoryboardMeta | null;
  clickEvents: ClickEvent[];
  onSeek: (sourceTime: number) => void;
  onAddZoom: (at: number) => void;
  onAddBlur: (at: number) => void;
}

interface DragSession {
  pointerId: number;
  originX: number;
  moved: boolean;
  apply: (deltaSeconds: number) => void;
  onClick?: () => void;
}

export function Timeline({ duration, storyboard, clickEvents, onSeek, onAddZoom, onAddBlur }: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const edit = useEditorStore((s) => s.edit);
  const selection = useEditorStore((s) => s.selection);
  const zoom = useEditorStore((s) => s.timelineZoom);
  const setZoom = useEditorStore((s) => s.setTimelineZoom);
  const select = useEditorStore((s) => s.select);
  const beginGesture = useEditorStore((s) => s.beginGesture);
  const updateGesture = useEditorStore((s) => s.updateGesture);
  const endGesture = useEditorStore((s) => s.endGesture);
  const drag = useRef<DragSession | null>(null);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewportWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const safeDuration = Math.max(duration, 0.1);
  const fitPps = viewportWidth > 0 ? (viewportWidth - PAD * 2) / safeDuration : 0;
  const pps = fitPps * zoom;
  const contentWidth = Math.max(viewportWidth, safeDuration * pps + PAD * 2);
  const xOf = useCallback((t: number) => PAD + t * pps, [pps]);
  const timeAt = useCallback(
    (clientX: number) => {
      const element = viewportRef.current;
      if (!element || pps <= 0) return 0;
      const rect = element.getBoundingClientRect();
      return clamp((clientX - rect.left + element.scrollLeft - PAD) / pps, 0, duration);
    },
    [pps, duration],
  );

  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  useEffect(() => {
    const position = (time: number, playing: boolean) => {
      const element = playheadRef.current;
      const viewport = viewportRef.current;
      if (!element || !viewport) return;
      const x = PAD + time * ppsRef.current;
      element.style.transform = `translateX(${x}px)`;
      if (playing) {
        const right = viewport.scrollLeft + viewport.clientWidth;
        if (x > right - 40 || x < viewport.scrollLeft) viewport.scrollLeft = Math.max(0, x - 80);
      }
    };
    const initial = usePlayerStore.getState();
    position(initial.sourceTime, false);
    return usePlayerStore.subscribe((state) => position(state.sourceTime, state.playing));
  }, [pps]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const currentZoom = useEditorStore.getState().timelineZoom;
      const anchorTime = (cursorX + viewport.scrollLeft - PAD) / (fitPps * currentZoom);
      const nextZoom = clamp(currentZoom * Math.exp(-event.deltaY * 0.004), 1, 20);
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, PAD + anchorTime * fitPps * nextZoom - cursorX);
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [fitPps, setZoom]);

  const startDrag = (event: ReactPointerEvent, apply: DragSession['apply'], onClick?: () => void) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, originX: event.clientX, moved: false, apply, onClick };
  };

  const onDragMove = (event: ReactPointerEvent) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.originX;
    if (!session.moved && Math.abs(dx) < 3) return;
    if (!session.moved) {
      session.moved = true;
      beginGesture();
    }
    session.apply(dx / ppsRef.current);
  };

  const onDragEnd = (event: ReactPointerEvent) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    drag.current = null;
    if (session.moved) endGesture();
    else session.onClick?.();
  };

  const snapCandidates = useMemo(() => {
    const points = [0, duration, edit.trim.start, edit.trim.end, ...edit.splits];
    for (const z of edit.zooms) points.push(z.start, z.end);
    for (const b of edit.blurs) points.push(b.start, b.end);
    return points;
  }, [edit, duration]);

  const snapTime = (value: number, exclude: number[]) => {
    const playhead = usePlayerStore.getState().sourceTime;
    const candidates = [playhead, ...snapCandidates.filter((c) => !exclude.some((e) => Math.abs(e - c) < 1e-6))];
    return snap(value, candidates, SNAP_PX / Math.max(ppsRef.current, 1e-3));
  };

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onSeek(timeAt(event.clientX));
    const move = (e: PointerEvent) => onSeek(timeAt(e.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const step = tickStep(Math.max(pps, 1e-3));
  const ticks = useMemo(() => {
    if (pps <= 0) return [];
    const list: number[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step) list.push(Math.round(t * 1000) / 1000);
    return list;
  }, [pps, duration, step]);

  const segments = useMemo(() => splitSegments(edit), [edit]);
  const sortedZooms = useMemo(() => [...edit.zooms].sort((a, b) => a.start - b.start), [edit.zooms]);

  const frameAspect = storyboard ? storyboard.frameWidth / Math.max(1, storyboard.frameHeight) : 16 / 9;
  const tileWidth = Math.max(40, (VIDEO_TRACK_HEIGHT - 8) * frameAspect);
  const tileCount = Math.ceil((contentWidth - PAD * 2) / tileWidth);

  return (
    <div className="flex select-none border-t border-white/[0.06] bg-ink-950/60">
      <div className="w-[92px] shrink-0 border-r border-white/[0.06] pt-7">
        <TrackLabel icon={<Film className="h-3.5 w-3.5" />} label="Video" height={VIDEO_TRACK_HEIGHT} />
        <TrackLabel icon={<ScanSearch className="h-3.5 w-3.5" />} label="Zoom" height={36} />
        <TrackLabel icon={<SquareDashed className="h-3.5 w-3.5" />} label="Blur" height={36} />
      </div>

      <div ref={viewportRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-2" onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <div
          className="relative"
          style={{ width: contentWidth }}
          onPointerMove={(e) => {
            const rect = viewportRef.current?.getBoundingClientRect();
            if (rect && viewportRef.current) setHoverX(e.clientX - rect.left + viewportRef.current.scrollLeft);
          }}
          onPointerLeave={() => setHoverX(null)}
        >
          <div className="relative h-7 cursor-pointer border-b border-white/[0.05]" onPointerDown={scrub}>
            {ticks.map((t) => (
              <div key={t} className="absolute bottom-0 top-0" style={{ left: xOf(t) }}>
                <div className="absolute bottom-0 h-2 w-px bg-white/20" />
                <span className="tabular absolute left-1.5 top-1 whitespace-nowrap font-mono text-[10px] text-white/35">{formatRulerLabel(t, step)}</span>
              </div>
            ))}
            {ticks.map((t) => (
              <div key={`m${t}`} className="absolute bottom-0 h-1 w-px bg-white/10" style={{ left: xOf(t + step / 2) }} />
            ))}
          </div>

          <div className="relative mt-1" style={{ height: VIDEO_TRACK_HEIGHT }}>
            <div
              className="absolute inset-y-1 overflow-hidden rounded-lg border border-white/10 bg-ink-800"
              style={{ left: PAD, width: Math.max(0, contentWidth - PAD * 2) }}
              onPointerDown={scrub}
            >
              <div className="flex h-full">
                {storyboard &&
                  Array.from({ length: tileCount }, (_, i) => {
                    const centerTime = ((i + 0.5) * tileWidth) / Math.max(pps, 1e-3);
                    const index = clamp(Math.floor(centerTime / storyboard.interval), 0, storyboard.frames - 1);
                    const h = VIDEO_TRACK_HEIGHT - 10;
                    const w = h * frameAspect;
                    return (
                      <div
                        key={i}
                        className="h-full shrink-0 border-r border-black/40 opacity-80"
                        style={{
                          width: tileWidth,
                          backgroundImage: `url(${storyboard.url})`,
                          backgroundSize: `${storyboard.frames * w}px ${h}px`,
                          backgroundPosition: `${-index * w}px 0`,
                          backgroundRepeat: 'no-repeat',
                        }}
                      />
                    );
                  })}
              </div>
            </div>

            <div className="pointer-events-none absolute inset-y-1 rounded-l-lg bg-ink-950/80" style={{ left: PAD, width: Math.max(0, xOf(edit.trim.start) - PAD) }} />
            <div className="pointer-events-none absolute inset-y-1 rounded-r-lg bg-ink-950/80" style={{ left: xOf(edit.trim.end), width: Math.max(0, xOf(duration) - xOf(edit.trim.end)) }} />

            {segments.map((segment) => {
              const selected = selection?.kind === 'segment' && selection.index === segment.index;
              return (
                <div
                  key={`${segment.index}-${segment.start}`}
                  className={cn(
                    'group/seg absolute inset-y-1 cursor-pointer rounded-md border transition-colors',
                    segment.cut ? 'border-danger/40 bg-hatch' : 'border-transparent hover:border-white/25',
                    selected && 'border-accent shadow-[0_0_0_1px_rgba(0,250,154,0.6),0_0_18px_-4px_rgba(0,250,154,0.7)]',
                  )}
                  style={{ left: xOf(segment.start), width: Math.max(2, xOf(segment.end) - xOf(segment.start)) }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    select({ kind: 'segment', index: segment.index });
                    onSeek(timeAt(event.clientX));
                  }}
                >
                  {segment.cut && (
                    <span className="absolute inset-0 flex items-center justify-center bg-ink-950/50">
                      <span className="flex items-center gap-1 rounded-md bg-ink-900/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
                        <Scissors className="h-3 w-3" /> Cut
                      </span>
                    </span>
                  )}
                </div>
              );
            })}

            {edit.splits.map((split) => (
              <div key={split} className="pointer-events-none absolute -top-1 bottom-0 w-px bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.6)]" style={{ left: xOf(split) }}>
                <span className="absolute -left-[4px] -top-0.5 h-[9px] w-[9px] rotate-45 rounded-[2px] bg-white" />
              </div>
            ))}

            <TrimHandle
              x={xOf(edit.trim.start)}
              side="start"
              onPointerDown={(event) => {
                const origin = edit.trim.start;
                startDrag(event, (delta) => {
                  updateGesture((current) => {
                    const value = clamp(snapTime(origin + delta, [origin]), 0, current.trim.end - 0.5);
                    onSeek(value);
                    return { ...current, trim: { ...current.trim, start: value } };
                  });
                });
              }}
            />
            <TrimHandle
              x={xOf(edit.trim.end)}
              side="end"
              onPointerDown={(event) => {
                const origin = edit.trim.end;
                startDrag(event, (delta) => {
                  updateGesture((current) => {
                    const value = clamp(snapTime(origin + delta, [origin]), current.trim.start + 0.5, duration);
                    onSeek(Math.max(current.trim.start, value - 0.05));
                    return { ...current, trim: { ...current.trim, end: value } };
                  });
                });
              }}
            />
          </div>

          <Track
            height={36}
            empty={sortedZooms.length === 0}
            onDoubleClick={(event) => onAddZoom(timeAt(event.clientX))}
            onPointerDown={scrub}
            hint="Double-click to add a zoom · Z"
          >
            {clickEvents.map((click, i) => (
              <span
                key={`${click.t}-${i}`}
                className="pointer-events-none absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25"
                style={{ left: xOf(click.t) - 2 }}
              />
            ))}
            {sortedZooms.map((zoomSegment, index) => {
              const previous = sortedZooms[index - 1];
              const next = sortedZooms[index + 1];
              const lower = previous ? previous.end : 0;
              const upper = next ? next.start : duration;
              return (
                <RangeItem
                  key={zoomSegment.id}
                  left={xOf(zoomSegment.start)}
                  width={xOf(zoomSegment.end) - xOf(zoomSegment.start)}
                  selected={selection?.kind === 'zoom' && selection.id === zoomSegment.id}
                  tone={zoomSegment.source === 'auto' ? 'accent-soft' : 'accent'}
                  label={`${zoomSegment.scale.toFixed(1)}×${zoomSegment.source === 'auto' ? ' · auto' : ''}`}
                  onPointerDown={(event, mode) => {
                    const origin = { start: zoomSegment.start, end: zoomSegment.end };
                    startDrag(
                      event,
                      (delta) =>
                        updateGesture((current) => ({
                          ...current,
                          zooms: current.zooms.map((z) => {
                            if (z.id !== zoomSegment.id) return z;
                            const range = moveRange(origin, delta, mode, lower, upper, (v) => snapTime(v, [origin.start, origin.end]));
                            return { ...z, ...range };
                          }),
                        })),
                      () => {
                        select({ kind: 'zoom', id: zoomSegment.id });
                        onSeek(zoomSegment.start + Math.min(0.5, (zoomSegment.end - zoomSegment.start) / 2));
                      },
                    );
                    select({ kind: 'zoom', id: zoomSegment.id });
                  }}
                />
              );
            })}
          </Track>

          <Track
            height={36}
            empty={edit.blurs.length === 0}
            onDoubleClick={(event) => onAddBlur(timeAt(event.clientX))}
            onPointerDown={scrub}
            hint="Double-click to add a blur · B"
          >
            {edit.blurs.map((blur, index) => (
              <RangeItem
                key={blur.id}
                left={xOf(blur.start)}
                width={xOf(blur.end) - xOf(blur.start)}
                selected={selection?.kind === 'blur' && selection.id === blur.id}
                tone="violet"
                label={`Blur ${index + 1}`}
                onPointerDown={(event, mode) => {
                  const origin = { start: blur.start, end: blur.end };
                  startDrag(
                    event,
                    (delta) =>
                      updateGesture((current) => ({
                        ...current,
                        blurs: current.blurs.map((b) =>
                          b.id === blur.id ? { ...b, ...moveRange(origin, delta, mode, 0, duration, (v) => snapTime(v, [origin.start, origin.end])) } : b,
                        ),
                      })),
                    () => {
                      select({ kind: 'blur', id: blur.id });
                      onSeek(blur.start + Math.min(0.2, (blur.end - blur.start) / 2));
                    },
                  );
                  select({ kind: 'blur', id: blur.id });
                }}
              />
            ))}
          </Track>

          {hoverX !== null && !drag.current && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-white/25" style={{ left: hoverX }}>
              <span className="tabular absolute -left-7 top-0.5 w-14 rounded bg-ink-700 py-px text-center font-mono text-[10px] text-white/80">
                {formatPrecise(clamp((hoverX - PAD) / Math.max(pps, 1e-3), 0, duration))}
              </span>
            </div>
          )}

          <div ref={playheadRef} className="pointer-events-none absolute bottom-0 left-0 top-0 z-20 will-change-transform">
            <div className="absolute -left-[6px] top-0 h-3.5 w-3 rounded-b-[4px] rounded-t-[2px] bg-accent shadow-[0_0_12px_rgba(0,250,154,0.9)]" />
            <div className="absolute bottom-0 left-[-0.5px] top-3 w-px bg-accent shadow-[0_0_8px_rgba(0,250,154,0.9)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

type DragMode = 'move' | 'start' | 'end';

function moveRange(
  origin: { start: number; end: number },
  delta: number,
  mode: DragMode,
  lower: number,
  upper: number,
  snapFn: (value: number) => number,
): { start: number; end: number } {
  const length = origin.end - origin.start;
  if (mode === 'move') {
    let start = snapFn(origin.start + delta);
    if (start === origin.start + delta) {
      const snappedEnd = snapFn(origin.end + delta);
      start = snappedEnd - length;
    }
    start = clamp(start, lower, Math.max(lower, upper - length));
    return { start, end: start + length };
  }
  if (mode === 'start') {
    const start = clamp(snapFn(origin.start + delta), lower, origin.end - MIN_ITEM_SECONDS);
    return { start, end: origin.end };
  }
  const end = clamp(snapFn(origin.end + delta), origin.start + MIN_ITEM_SECONDS, upper);
  return { start: origin.start, end };
}

function TrackLabel({ icon, label, height }: { icon: ReactNode; label: string; height: number }) {
  return (
    <div className="mt-1 flex items-center gap-2 px-3 text-[11px] font-medium text-white/45" style={{ height }}>
      <span className="text-white/35">{icon}</span>
      {label}
    </div>
  );
}

function Track({
  height,
  children,
  onDoubleClick,
  onPointerDown,
  hint,
  empty,
}: {
  height: number;
  children: ReactNode;
  empty: boolean;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  hint: string;
}) {
  return (
    <div className="group/track relative mt-1" style={{ height }} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown}>
      <div className="absolute inset-x-[14px] inset-y-1 rounded-md border border-dashed border-white/[0.06] transition-colors group-hover/track:border-white/[0.12]" />
      {empty && (
        <span className="pointer-events-none sticky left-0 flex h-full items-center pl-6 text-[10.5px] text-white/20 opacity-0 transition-opacity group-hover/track:opacity-100">
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

const TONES = {
  accent: 'border-accent/60 bg-accent/20 text-accent-100',
  'accent-soft': 'border-accent/35 bg-accent/[0.09] text-accent-200/90',
  violet: 'border-violet-400/60 bg-violet-400/20 text-violet-100',
};

function RangeItem({
  left,
  width,
  selected,
  tone,
  label,
  onPointerDown,
}: {
  left: number;
  width: number;
  selected: boolean;
  tone: keyof typeof TONES;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => void;
}) {
  return (
    <div
      className={cn(
        'group/item absolute inset-y-1 z-[5] cursor-grab overflow-hidden rounded-md border backdrop-blur-sm transition-shadow active:cursor-grabbing',
        TONES[tone],
        selected && 'z-[6] shadow-[0_0_0_1.5px_rgba(255,255,255,0.85),0_6px_18px_-6px_rgba(0,0,0,0.8)]',
      )}
      style={{ left, width: Math.max(6, width) }}
      onPointerDown={(event) => onPointerDown(event, 'move')}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center truncate px-2.5 text-[10.5px] font-semibold">{width > 46 ? label : ''}</span>
      <div
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 transition-colors hover:bg-white/30"
        onPointerDown={(event) => onPointerDown(event, 'start')}
      />
      <div
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 transition-colors hover:bg-white/30"
        onPointerDown={(event) => onPointerDown(event, 'end')}
      />
    </div>
  );
}

function TrimHandle({ x, side, onPointerDown }: { x: number; side: 'start' | 'end'; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      className="group/trim absolute inset-y-0 z-[8] -ml-1.5 flex w-3 cursor-ew-resize items-center justify-center"
      style={{ left: x }}
      onPointerDown={onPointerDown}
      title={side === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
    >
      <div className="flex h-full w-[9px] items-center justify-center rounded-[4px] bg-warn shadow-[0_0_14px_-2px_rgba(255,181,71,0.8)] transition-transform group-hover/trim:scale-x-125">
        <span className="h-4 w-[2px] rounded-full bg-ink-900/70" />
      </div>
    </div>
  );
}
