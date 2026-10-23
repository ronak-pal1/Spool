import { activeBlurs, normalizeRect, type BlurRegion, type NormalizedRect, type ZoomSegment } from '@spool/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { useFitBox, useStableUrl } from '@/lib/media';
import { createLocalId } from '@/lib/viewer';
import { useEditorStore } from '@/store/editor.store';
import { usePlayerStore } from '@/store/player.store';
import { BlurOverlays } from '../player/BlurOverlays';
import { usePlaybackEngine } from '../player/usePlaybackEngine';
import { clamp } from './timeline-math';

interface EditorPreviewProps {
  src: string;
  poster: string | null;
  width: number;
  height: number;
  duration: number;
  drawing: boolean;
  onDrawingDone: () => void;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

export function EditorPreview({ src, poster, width, height, duration, drawing, onDrawingDone }: EditorPreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stableSrc = useStableUrl(src);
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const box = useFitBox(frameRef, ratio);

  const edit = useEditorStore((s) => s.edit);
  const selection = useEditorStore((s) => s.selection);
  const previewEdits = useEditorStore((s) => s.previewEdits);
  const select = useEditorStore((s) => s.select);
  const update = useEditorStore((s) => s.update);
  const beginGesture = useEditorStore((s) => s.beginGesture);
  const updateGesture = useEditorStore((s) => s.updateGesture);
  const endGesture = useEditorStore((s) => s.endGesture);
  const playing = usePlayerStore((s) => s.playing);
  const register = usePlayerStore((s) => s.register);
  const [pausedTime, setPausedTime] = useState(0);
  const [draft, setDraft] = useState<NormalizedRect | null>(null);

  const selectedBlur = selection?.kind === 'blur' ? (edit.blurs.find((b) => b.id === selection.id) ?? null) : null;
  const selectedZoom = selection?.kind === 'zoom' ? (edit.zooms.find((z) => z.id === selection.id) ?? null) : null;
  const framing = !playing && (Boolean(selectedBlur) || Boolean(selectedZoom) || drawing);

  const onTick = useCallback((time: number) => {
    usePlayerStore.setState({ sourceTime: time });
    const video = videoRef.current;
    if (video?.paused) setPausedTime(time);
  }, []);

  const { blurs } = usePlaybackEngine({ videoRef, stageRef, edit, applyCuts: previewEdits, applyEffects: !framing, onTick });

  useEffect(() => {
    const controller = {
      seek: (time: number, play?: boolean) => {
        const video = videoRef.current;
        if (!video) return;
        const target = clamp(time, 0, duration);
        video.currentTime = target;
        usePlayerStore.setState({ sourceTime: target });
        if (play) void video.play().catch(() => undefined);
      },
      play: () => void videoRef.current?.play().catch(() => undefined),
      pause: () => videoRef.current?.pause(),
    };
    register(controller);
    return () => register(null);
  }, [register, duration]);

  const framingBlurs = useMemo(() => {
    if (!framing) return [];
    const visible = activeBlurs(edit.blurs, pausedTime);
    if (selectedBlur && !visible.some((b) => b.id === selectedBlur.id)) visible.push(selectedBlur);
    return visible;
  }, [framing, edit.blurs, pausedTime, selectedBlur]);

  const normalizedPoint = (clientX: number, clientY: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: clamp((clientX - rect.left) / rect.width, 0, 1), y: clamp((clientY - rect.top) / rect.height, 0, 1) };
  };

  const startDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const origin = normalizedPoint(event.clientX, event.clientY);
    let current: NormalizedRect = { x: origin.x, y: origin.y, width: 0, height: 0 };
    setDraft(current);
    const move = (e: PointerEvent) => {
      const p = normalizedPoint(e.clientX, e.clientY);
      current = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), width: Math.abs(p.x - origin.x), height: Math.abs(p.y - origin.y) };
      setDraft(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      onDrawingDone();
      if (current.width < 0.015 || current.height < 0.015) return;
      const start = usePlayerStore.getState().sourceTime;
      const blur: BlurRegion = {
        id: createLocalId(),
        start,
        end: Math.min(duration, start + 4),
        rect: normalizeRect(current),
        intensity: 6,
      };
      update((e) => ({ ...e, blurs: [...e.blurs, blur] }));
      select({ kind: 'blur', id: blur.id });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragRect = (event: ReactPointerEvent, blur: BlurRegion, corner: Corner | 'move') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = normalizedPoint(event.clientX, event.clientY);
    const start = blur.rect;
    let began = false;
    const move = (e: PointerEvent) => {
      const p = normalizedPoint(e.clientX, e.clientY);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      if (!began) {
        if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return;
        began = true;
        beginGesture();
      }
      let next: NormalizedRect;
      if (corner === 'move') {
        next = { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) };
      } else {
        let left = start.x;
        let top = start.y;
        let right = start.x + start.width;
        let bottom = start.y + start.height;
        if (corner.includes('w')) left = clamp(start.x + dx, 0, right - 0.02);
        if (corner.includes('e')) right = clamp(right + dx, left + 0.02, 1);
        if (corner.includes('n')) top = clamp(start.y + dy, 0, bottom - 0.02);
        if (corner.includes('s')) bottom = clamp(bottom + dy, top + 0.02, 1);
        next = { x: left, y: top, width: right - left, height: bottom - top };
      }
      updateGesture((current) => ({ ...current, blurs: current.blurs.map((b) => (b.id === blur.id ? { ...b, rect: next } : b)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (began) endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragZoomFrame = (event: ReactPointerEvent, zoom: ZoomSegment) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const inverse = 1 - 1 / zoom.scale;
    const origin = normalizedPoint(event.clientX, event.clientY);
    const startLeft = zoom.focus.x * inverse;
    const startTop = zoom.focus.y * inverse;
    let began = false;
    const move = (e: PointerEvent) => {
      const p = normalizedPoint(e.clientX, e.clientY);
      if (!began) {
        began = true;
        beginGesture();
      }
      const left = clamp(startLeft + (p.x - origin.x), 0, inverse);
      const top = clamp(startTop + (p.y - origin.y), 0, inverse);
      const focus = { x: inverse > 0 ? left / inverse : 0.5, y: inverse > 0 ? top / inverse : 0.5 };
      updateGesture((current) => ({ ...current, zooms: current.zooms.map((z) => (z.id === zoom.id ? { ...z, focus } : z)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (began) endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <div ref={frameRef} className="relative flex h-full w-full items-center justify-center">
      <div
        ref={boxRef}
        className={cn('relative overflow-hidden rounded-xl bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] ring-1 ring-white/10', drawing && 'cursor-crosshair')}
        style={{ width: box.width || '100%', height: box.height || '100%' }}
        onPointerDown={startDraw}
      >
        <div ref={stageRef} className="absolute inset-0 will-change-transform">
          {stableSrc && (
            <video
              ref={videoRef}
              src={stableSrc}
              poster={poster ?? undefined}
              playsInline
              preload="auto"
              className="h-full w-full object-contain"
              onClick={() => {
                if (drawing) return;
                if (!framing) togglePlay();
                else select(null);
              }}
              onPlay={() => usePlayerStore.setState({ playing: true })}
              onPause={() => usePlayerStore.setState({ playing: false })}
              onEnded={() => usePlayerStore.setState({ playing: false })}
            />
          )}
          {!framing && <BlurOverlays blurs={blurs} />}
        </div>

        {framing && <BlurOverlays blurs={framingBlurs} />}

        {framing && selectedZoom && (
          <ZoomFrame zoom={selectedZoom} onPointerDown={(event) => dragZoomFrame(event, selectedZoom)} />
        )}

        {framing &&
          edit.blurs.map((blur) => {
            const isSelected = blur.id === selectedBlur?.id;
            const visible = isSelected || (pausedTime >= blur.start && pausedTime <= blur.end);
            if (!visible) return null;
            return (
              <div
                key={blur.id}
                className={cn(
                  'absolute rounded-[4px] border-2',
                  isSelected ? 'z-10 cursor-move border-violet-300 shadow-[0_0_24px_rgba(167,139,250,0.5)]' : 'cursor-pointer border-dashed border-white/40',
                )}
                style={{ left: `${blur.rect.x * 100}%`, top: `${blur.rect.y * 100}%`, width: `${blur.rect.width * 100}%`, height: `${blur.rect.height * 100}%` }}
                onPointerDown={(event) => {
                  if (drawing) return;
                  if (!isSelected) {
                    event.stopPropagation();
                    select({ kind: 'blur', id: blur.id });
                    return;
                  }
                  dragRect(event, blur, 'move');
                }}
              >
                {isSelected &&
                  (['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => (
                    <span
                      key={corner}
                      onPointerDown={(event) => dragRect(event, blur, corner)}
                      className={cn(
                        'absolute h-3 w-3 rounded-[3px] border-2 border-violet-300 bg-ink-900',
                        corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                        corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                        corner === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                        corner === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                      )}
                    />
                  ))}
              </div>
            );
          })}

        {draft && (
          <div
            className="pointer-events-none absolute rounded-[4px] border-2 border-violet-300 bg-violet-400/10 backdrop-blur-md"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }}
          />
        )}

        {drawing && !draft && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full border border-violet-300/40 bg-ink-900/85 px-3 py-1 text-xs font-medium text-violet-100 backdrop-blur-md">
              Drag over the area you want to blur · Esc to cancel
            </span>
          </div>
        )}

        {framing && selectedZoom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="rounded-full border border-accent/30 bg-ink-900/85 px-3 py-1 text-xs font-medium text-accent-100 backdrop-blur-md">
              Drag the frame to choose what the camera zooms into
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ZoomFrame({ zoom, onPointerDown }: { zoom: ZoomSegment; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  const size = 1 / zoom.scale;
  const inverse = 1 - size;
  const left = zoom.focus.x * inverse;
  const top = zoom.focus.y * inverse;
  return (
    <div className="absolute inset-0 z-20">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1 1">
        <defs>
          <mask id={`zoom-mask-${zoom.id}`}>
            <rect x="0" y="0" width="1" height="1" fill="white" />
            <rect x={left} y={top} width={size} height={size} fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="1" height="1" fill="rgba(5,6,7,0.62)" mask={`url(#zoom-mask-${zoom.id})`} />
      </svg>
      <div
        className="absolute cursor-move rounded-md border-2 border-accent shadow-[0_0_30px_-4px_rgba(0,250,154,0.7)]"
        style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${size * 100}%`, height: `${size * 100}%` }}
        onPointerDown={onPointerDown}
      >
        <span className="absolute -top-6 left-0 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent-foreground">{zoom.scale.toFixed(1)}×</span>
        <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-accent/80" />
        <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-accent/80" />
      </div>
    </div>
  );
}
