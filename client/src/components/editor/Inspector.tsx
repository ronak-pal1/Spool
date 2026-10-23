import {
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  editedDuration,
  generateAutoZooms,
  splitSegments,
  toggleSegmentCut,
  type ClickEvent,
  type ZoomSegment,
} from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Crosshair, MousePointerClick, RotateCcw, ScanSearch, Scissors, SquareDashed, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { createLocalId } from '@/lib/viewer';
import { useEditorStore } from '@/store/editor.store';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';
import { Button } from '../ui/Button';
import { Badge, Kbd } from '../ui/misc';
import { formatPrecise, parseTimeInput } from './timeline-math';

interface InspectorProps {
  duration: number;
  clickEvents: ClickEvent[];
}

export function Inspector({ duration, clickEvents }: InspectorProps) {
  const selection = useEditorStore((s) => s.selection);
  const key = selection ? (selection.kind === 'segment' ? `segment-${selection.index}` : `${selection.kind}-${selection.id}`) : 'none';
  return (
    <div className="h-full overflow-y-auto">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6, transition: { duration: 0.08 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 36 }}
          className="space-y-5 p-4"
        >
          {selection?.kind === 'blur' && <BlurInspector id={selection.id} duration={duration} />}
          {selection?.kind === 'zoom' && <ZoomInspector id={selection.id} duration={duration} />}
          {selection?.kind === 'segment' && <SegmentInspector index={selection.index} />}
          {!selection && <Overview duration={duration} clickEvents={clickEvents} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Section({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white">
          {icon && <span className="text-white/45">{icon}</span>}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TimeField({ label, value, onCommit, min, max }: { label: string; value: number; onCommit: (value: number) => void; min: number; max: number }) {
  const [text, setText] = useState(formatPrecise(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatPrecise(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setText(formatPrecise(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onCommit(clamped);
    setText(formatPrecise(clamped));
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setText(formatPrecise(value));
      event.currentTarget.blur();
    }
    event.stopPropagation();
  };

  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={onKey}
        className="tabular mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-ink-800 px-2.5 font-mono text-[13px] text-white outline-none transition focus:border-accent/50 focus:shadow-[0_0_0_3px_rgba(0,250,154,0.1)]"
      />
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, onCommit, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  format: (value: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="tabular font-mono text-xs text-white/70">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="mt-2.5 w-full"
        style={{ background: `linear-gradient(to right, rgba(0,250,154,0.8) ${pct}%, transparent ${pct}%)`, borderRadius: 999, height: 4 }}
      />
    </label>
  );
}

function JumpButton({ time }: { time: number }) {
  return (
    <Button size="xs" variant="ghost" onClick={() => usePlayerStore.getState().seek(time, false)} leftIcon={<Crosshair className="h-3 w-3" />}>
      Jump to
    </Button>
  );
}

function BlurInspector({ id, duration }: { id: string; duration: number }) {
  const blur = useEditorStore((s) => s.edit.blurs.find((b) => b.id === id));
  const index = useEditorStore((s) => s.edit.blurs.findIndex((b) => b.id === id));
  const update = useEditorStore((s) => s.update);
  const updateGesture = useEditorStore((s) => s.updateGesture);
  const endGesture = useEditorStore((s) => s.endGesture);
  const select = useEditorStore((s) => s.select);
  if (!blur) return null;

  const patch = (changes: Partial<typeof blur>) => update((e) => ({ ...e, blurs: e.blurs.map((b) => (b.id === id ? { ...b, ...changes } : b)) }));

  return (
    <>
      <Section title={`Blur ${index + 1}`} icon={<SquareDashed className="h-4 w-4" />} action={<JumpButton time={blur.start} />}>
        <p className="text-xs leading-relaxed text-white/45">Hides sensitive content in this area. Drag the box on the preview to move or resize it.</p>
      </Section>
      <div className="grid grid-cols-2 gap-3">
        <TimeField label="Start" value={blur.start} min={0} max={blur.end - 0.1} onCommit={(start) => patch({ start })} />
        <TimeField label="End" value={blur.end} min={blur.start + 0.1} max={duration} onCommit={(end) => patch({ end })} />
      </div>
      <Slider
        label="Strength"
        min={1}
        max={10}
        step={1}
        value={blur.intensity}
        format={(v) => `${v}/10`}
        onChange={(intensity) => updateGesture((e) => ({ ...e, blurs: e.blurs.map((b) => (b.id === id ? { ...b, intensity } : b)) }))}
        onCommit={endGesture}
      />
      <div className="grid grid-cols-4 gap-2 rounded-xl border border-white/[0.06] bg-ink-900/50 p-3 text-center">
        {(['x', 'y', 'width', 'height'] as const).map((k) => (
          <div key={k}>
            <p className="label">{k === 'width' ? 'W' : k === 'height' ? 'H' : k.toUpperCase()}</p>
            <p className="tabular mt-1 font-mono text-xs text-white/75">{Math.round(blur.rect[k] * 100)}%</p>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/10"
        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        onClick={() => {
          update((e) => ({ ...e, blurs: e.blurs.filter((b) => b.id !== id) }));
          select(null);
        }}
      >
        Delete blur
      </Button>
    </>
  );
}

function ZoomInspector({ id, duration }: { id: string; duration: number }) {
  const zoom = useEditorStore((s) => s.edit.zooms.find((z) => z.id === id));
  const zooms = useEditorStore((s) => s.edit.zooms);
  const neighbors = useMemo(() => {
    const sorted = [...zooms].sort((a, b) => a.start - b.start);
    const i = sorted.findIndex((z) => z.id === id);
    return { lower: sorted[i - 1]?.end ?? 0, upper: sorted[i + 1]?.start ?? duration };
  }, [zooms, id, duration]);
  const update = useEditorStore((s) => s.update);
  const updateGesture = useEditorStore((s) => s.updateGesture);
  const endGesture = useEditorStore((s) => s.endGesture);
  const select = useEditorStore((s) => s.select);
  if (!zoom) return null;

  const patch = (changes: Partial<ZoomSegment>) =>
    update((e) => ({ ...e, zooms: e.zooms.map((z) => (z.id === id ? { ...z, ...changes, source: 'manual' as const } : z)) }));

  return (
    <>
      <Section
        title="Zoom"
        icon={<ScanSearch className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1">
            {zoom.source === 'auto' && (
              <Badge tone="accent">
                <MousePointerClick className="h-3 w-3" /> Auto
              </Badge>
            )}
            <JumpButton time={zoom.start} />
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-white/45">The camera eases in, holds on the framed area, then eases back out. Pause and drag the frame on the preview to reposition it.</p>
      </Section>
      <div className="grid grid-cols-2 gap-3">
        <TimeField label="Start" value={zoom.start} min={neighbors.lower} max={zoom.end - 0.3} onCommit={(start) => patch({ start })} />
        <TimeField label="End" value={zoom.end} min={zoom.start + 0.3} max={neighbors.upper} onCommit={(end) => patch({ end })} />
      </div>
      <Slider
        label="Magnification"
        min={MIN_ZOOM_SCALE}
        max={MAX_ZOOM_SCALE}
        step={0.05}
        value={zoom.scale}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(scale) => updateGesture((e) => ({ ...e, zooms: e.zooms.map((z) => (z.id === id ? { ...z, scale, source: 'manual' } : z)) }))}
        onCommit={endGesture}
      />
      <div className="grid grid-cols-3 gap-2">
        {[1.5, 2, 2.5].map((preset) => (
          <button
            key={preset}
            onClick={() => patch({ scale: preset })}
            className={cn(
              'h-8 rounded-lg border text-xs font-medium transition-colors',
              Math.abs(zoom.scale - preset) < 0.01 ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white',
            )}
          >
            {preset}×
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-ink-900/50 px-3 py-2.5 text-xs">
        <span className="text-white/45">Focus point</span>
        <span className="tabular font-mono text-white/75">
          {Math.round(zoom.focus.x * 100)}%, {Math.round(zoom.focus.y * 100)}%
        </span>
        <Button size="xs" variant="ghost" onClick={() => patch({ focus: { x: 0.5, y: 0.5 } })} leftIcon={<RotateCcw className="h-3 w-3" />}>
          Center
        </Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/10"
        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        onClick={() => {
          update((e) => ({ ...e, zooms: e.zooms.filter((z) => z.id !== id) }));
          select(null);
        }}
      >
        Delete zoom
      </Button>
    </>
  );
}

function SegmentInspector({ index }: { index: number }) {
  const edit = useEditorStore((s) => s.edit);
  const update = useEditorStore((s) => s.update);
  const select = useEditorStore((s) => s.select);
  const segment = splitSegments(edit)[index];
  if (!segment) return null;
  const length = segment.end - segment.start;
  const leftSplit = edit.splits.includes(segment.start) ? segment.start : null;
  const rightSplit = edit.splits.includes(segment.end) ? segment.end : null;

  const toggle = () => update((e) => toggleSegmentCut(e, segment));

  const removeSplit = (at: number) => {
    update((e) => ({ ...e, splits: e.splits.filter((s) => s !== at) }));
    select(null);
  };

  return (
    <>
      <Section title={`Clip ${index + 1}`} icon={<Scissors className="h-4 w-4" />} action={<JumpButton time={segment.start} />}>
        <p className="text-xs leading-relaxed text-white/45">
          {segment.cut ? 'This clip is removed from the final video.' : 'Split the timeline with S, then cut the clips you don’t need.'}
        </p>
      </Section>
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-ink-900/50 p-3 text-center">
        <Stat label="Start" value={formatPrecise(segment.start)} />
        <Stat label="End" value={formatPrecise(segment.end)} />
        <Stat label="Length" value={formatPrecise(length)} />
      </div>
      <Button
        variant={segment.cut ? 'secondary' : 'outline'}
        size="sm"
        className={cn('w-full', !segment.cut && 'border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/10')}
        leftIcon={segment.cut ? <Undo2 className="h-3.5 w-3.5" /> : <Scissors className="h-3.5 w-3.5" />}
        onClick={toggle}
      >
        {segment.cut ? 'Restore clip' : 'Cut this clip'}
      </Button>
      {(leftSplit !== null || rightSplit !== null) && (
        <div className="grid grid-cols-2 gap-2">
          <Button size="xs" variant="ghost" disabled={leftSplit === null} onClick={() => leftSplit !== null && removeSplit(leftSplit)}>
            Merge with previous
          </Button>
          <Button size="xs" variant="ghost" disabled={rightSplit === null} onClick={() => rightSplit !== null && removeSplit(rightSplit)}>
            Merge with next
          </Button>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="tabular mt-1 font-mono text-xs text-white/80">{value}</p>
    </div>
  );
}

function Overview({ duration, clickEvents }: { duration: number; clickEvents: ClickEvent[] }) {
  const edit = useEditorStore((s) => s.edit);
  const update = useEditorStore((s) => s.update);
  const kept = editedDuration(edit);
  const removed = Math.max(0, duration - kept);
  const autoCount = edit.zooms.filter((z) => z.source === 'auto').length;

  const regenerate = () => {
    const manual = edit.zooms.filter((z) => z.source === 'manual');
    const generated = generateAutoZooms(clickEvents, duration, createLocalId).filter(
      (candidate) => !manual.some((m) => candidate.start < m.end && candidate.end > m.start),
    );
    update((e) => ({ ...e, zooms: [...manual, ...generated] }));
    toast.success(generated.length ? `Generated ${generated.length} auto zoom${generated.length === 1 ? '' : 's'}` : 'No click clusters to zoom into');
  };

  return (
    <>
      <Section title="Edit overview">
        <div className="grid grid-cols-2 gap-2">
          <OverviewStat label="Final length" value={formatPrecise(kept)} accent />
          <OverviewStat label="Removed" value={formatPrecise(removed)} />
          <OverviewStat label="Zooms" value={String(edit.zooms.length)} />
          <OverviewStat label="Blurs" value={String(edit.blurs.length)} />
        </div>
      </Section>

      <Section title="Auto zoom" icon={<Wand2 className="h-4 w-4" />}>
        <p className="text-xs leading-relaxed text-white/45">
          {clickEvents.length > 0
            ? `${clickEvents.length} clicks were captured while recording. Spool groups them into smooth zooms that follow your cursor.`
            : 'Recordings made with the Spool extension or desktop app capture clicks, which become automatic zooms. You can always add zooms manually.'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" disabled={clickEvents.length === 0} onClick={regenerate} leftIcon={<Wand2 className="h-3.5 w-3.5" />}>
            {autoCount ? 'Regenerate' : 'Generate'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={autoCount === 0}
            onClick={() => update((e) => ({ ...e, zooms: e.zooms.filter((z) => z.source !== 'auto') }))}
          >
            Clear auto
          </Button>
        </div>
      </Section>

      <Section title="Shortcuts">
        <div className="space-y-2 text-xs text-white/55">
          {[
            ['Play / pause', 'Space'],
            ['Split at playhead', 'S'],
            ['Cut clip at playhead', 'C'],
            ['Add zoom', 'Z'],
            ['Draw blur', 'B'],
            ['Delete selection', '⌫'],
            ['Step frame', '← →'],
            ['Undo / redo', '⌘Z / ⇧⌘Z'],
            ['Save', '⌘S'],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between">
              <span>{label}</span>
              <Kbd>{keys}</Kbd>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function OverviewStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', accent ? 'border-accent/25 bg-accent/[0.06]' : 'border-white/[0.06] bg-ink-900/50')}>
      <p className="label">{label}</p>
      <p className={cn('tabular mt-1 font-mono text-sm', accent ? 'text-accent' : 'text-white/85')}>{value}</p>
    </div>
  );
}
