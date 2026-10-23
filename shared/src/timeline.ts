import type {
  BlurRegion,
  ClickEvent,
  EditConfig,
  NormalizedPoint,
  NormalizedRect,
  TimeRange,
  ZoomSegment,
} from './types';

export const MIN_SEGMENT_SECONDS = 0.1;
export const ZOOM_RAMP_SECONDS = 0.45;
export const MIN_ZOOM_SCALE = 1.1;
export const MAX_ZOOM_SCALE = 3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

export function createDefaultEdit(duration: number): EditConfig {
  return {
    version: 1,
    trim: { start: 0, end: round3(Math.max(0, duration)) },
    splits: [],
    cuts: [],
    blurs: [],
    zooms: [],
  };
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start >= MIN_SEGMENT_SECONDS / 2)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1e-3) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function normalizeRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const width = clamp(rect.width, 0.01, 1 - x);
  const height = clamp(rect.height, 0.01, 1 - y);
  return { x: round3(x), y: round3(y), width: round3(width), height: round3(height) };
}

/**
 * Coerces an arbitrary edit config into a valid one for a video of `duration` seconds:
 * clamps every range into the trim window, merges overlapping cuts, removes degenerate
 * items and guarantees zoom segments never overlap.
 */
export function normalizeEdit(edit: EditConfig, duration: number): EditConfig {
  const total = Math.max(0, duration);
  let trimStart = clamp(edit.trim.start, 0, total);
  let trimEnd = clamp(edit.trim.end, 0, total);
  if (trimEnd - trimStart < MIN_SEGMENT_SECONDS) {
    trimStart = 0;
    trimEnd = total;
  }

  const splits = Array.from(
    new Set(
      edit.splits
        .filter((s) => Number.isFinite(s) && s > trimStart + MIN_SEGMENT_SECONDS / 2 && s < trimEnd - MIN_SEGMENT_SECONDS / 2)
        .map(round3),
    ),
  ).sort((a, b) => a - b);

  const cuts = mergeRanges(
    edit.cuts.map((c) => ({ start: clamp(c.start, trimStart, trimEnd), end: clamp(c.end, trimStart, trimEnd) })),
  ).map((c) => ({ start: round3(c.start), end: round3(c.end) }));

  const blurs: BlurRegion[] = edit.blurs
    .map((b) => ({
      id: b.id,
      start: round3(clamp(b.start, 0, total)),
      end: round3(clamp(b.end, 0, total)),
      rect: normalizeRect(b.rect),
      intensity: Math.round(clamp(b.intensity, 1, 10)),
    }))
    .filter((b) => b.end - b.start >= MIN_SEGMENT_SECONDS)
    .sort((a, b) => a.start - b.start);

  const zooms: ZoomSegment[] = [];
  const sortedZooms = edit.zooms
    .map((z) => ({
      id: z.id,
      start: round3(clamp(z.start, 0, total)),
      end: round3(clamp(z.end, 0, total)),
      focus: { x: round3(clamp01(z.focus.x)), y: round3(clamp01(z.focus.y)) },
      scale: Math.round(clamp(z.scale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE) * 100) / 100,
      source: z.source === 'auto' ? ('auto' as const) : ('manual' as const),
    }))
    .sort((a, b) => a.start - b.start);
  for (const zoom of sortedZooms) {
    const previous = zooms[zooms.length - 1];
    const start = previous ? Math.max(zoom.start, previous.end) : zoom.start;
    if (zoom.end - start >= MIN_SEGMENT_SECONDS * 3) {
      zooms.push({ ...zoom, start: round3(start) });
    }
  }

  return {
    version: 1,
    trim: { start: round3(trimStart), end: round3(trimEnd) },
    splits,
    cuts,
    blurs,
    zooms,
  };
}

/** Ranges of the source video that survive trimming and cutting, in playback order. */
export function keptRanges(edit: EditConfig): TimeRange[] {
  const kept: TimeRange[] = [];
  let cursor = edit.trim.start;
  for (const cut of mergeRanges(edit.cuts)) {
    if (cut.end <= cursor) continue;
    if (cut.start >= edit.trim.end) break;
    if (cut.start > cursor) kept.push({ start: cursor, end: Math.min(cut.start, edit.trim.end) });
    cursor = Math.max(cursor, cut.end);
  }
  if (edit.trim.end > cursor) kept.push({ start: cursor, end: edit.trim.end });
  return kept.filter((r) => r.end - r.start >= MIN_SEGMENT_SECONDS / 2);
}

export function editedDuration(edit: EditConfig): number {
  return keptRanges(edit).reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** Maps a source timestamp to the edited (post-cut) timeline. Times inside a cut collapse to the cut point. */
export function sourceToEdited(edit: EditConfig, sourceTime: number): number {
  let elapsed = 0;
  for (const range of keptRanges(edit)) {
    if (sourceTime <= range.start) return elapsed;
    if (sourceTime < range.end) return elapsed + (sourceTime - range.start);
    elapsed += range.end - range.start;
  }
  return elapsed;
}

/** Maps an edited-timeline timestamp back to the source video. */
export function editedToSource(edit: EditConfig, editedTime: number): number {
  const ranges = keptRanges(edit);
  let remaining = Math.max(0, editedTime);
  for (const range of ranges) {
    const length = range.end - range.start;
    if (remaining < length) return range.start + remaining;
    remaining -= length;
  }
  const last = ranges[ranges.length - 1];
  return last ? last.end : edit.trim.end;
}

export interface SnapResult {
  time: number;
  ended: boolean;
}

/** Moves a source time forward to the closest playable instant. */
export function snapToKept(edit: EditConfig, sourceTime: number): SnapResult {
  const ranges = keptRanges(edit);
  for (const range of ranges) {
    if (sourceTime < range.start) return { time: range.start, ended: false };
    if (sourceTime < range.end - 0.02) return { time: sourceTime, ended: false };
  }
  const last = ranges[ranges.length - 1];
  return { time: last ? last.end : edit.trim.end, ended: true };
}

export function isTimeKept(edit: EditConfig, sourceTime: number): boolean {
  return keptRanges(edit).some((r) => sourceTime >= r.start && sourceTime < r.end);
}

export interface TimelineSegment extends TimeRange {
  index: number;
  cut: boolean;
}

/** Splits the trim window at every split point; each piece is flagged when it lies inside a cut. */
export function splitSegments(edit: EditConfig): TimelineSegment[] {
  const bounds = [edit.trim.start, ...edit.splits, edit.trim.end];
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i] as number;
    const end = bounds[i + 1] as number;
    const mid = (start + end) / 2;
    const cut = edit.cuts.some((c) => c.start <= mid && c.end >= mid);
    segments.push({ index: i, start, end, cut });
  }
  return segments;
}

export function toggleSegmentCut(edit: EditConfig, segment: TimeRange): EditConfig {
  const mid = (segment.start + segment.end) / 2;
  const isCut = edit.cuts.some((c) => c.start <= mid && c.end >= mid);
  if (!isCut) {
    return { ...edit, cuts: mergeRanges([...edit.cuts, { start: segment.start, end: segment.end }]) };
  }
  const next: TimeRange[] = [];
  for (const cut of edit.cuts) {
    if (cut.end <= segment.start || cut.start >= segment.end) {
      next.push(cut);
      continue;
    }
    if (cut.start < segment.start) next.push({ start: cut.start, end: segment.start });
    if (cut.end > segment.end) next.push({ start: segment.end, end: cut.end });
  }
  return { ...edit, cuts: mergeRanges(next) };
}

export function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

export interface ZoomState {
  scale: number;
  focus: NormalizedPoint;
  active: ZoomSegment | null;
}

/**
 * Evaluates the zoom transform at `time`. The curve (smoothstep ramp in/out, origin anchored at
 * the focus point) is mirrored exactly by the server-side FFmpeg zoompan expression.
 */
export function zoomStateAt(zooms: ZoomSegment[], time: number): ZoomState {
  for (const zoom of zooms) {
    if (time < zoom.start || time > zoom.end) continue;
    const ramp = Math.min(ZOOM_RAMP_SECONDS, (zoom.end - zoom.start) / 2);
    const progress = Math.min((time - zoom.start) / ramp, (zoom.end - time) / ramp);
    const eased = smoothstep(progress);
    return { scale: 1 + (zoom.scale - 1) * eased, focus: zoom.focus, active: zoom };
  }
  return { scale: 1, focus: { x: 0.5, y: 0.5 }, active: null };
}

export function activeBlurs(blurs: BlurRegion[], time: number): BlurRegion[] {
  return blurs.filter((b) => time >= b.start && time <= b.end);
}

export interface AutoZoomOptions {
  scale?: number;
  clusterGapSeconds?: number;
  leadSeconds?: number;
  holdSeconds?: number;
  minDurationSeconds?: number;
}

/** Turns raw click telemetry captured while recording into smooth zoom segments. */
export function generateAutoZooms(
  clicks: ClickEvent[],
  duration: number,
  createId: () => string,
  options: AutoZoomOptions = {},
): ZoomSegment[] {
  const scale = options.scale ?? 1.8;
  const gap = options.clusterGapSeconds ?? 2.5;
  const lead = options.leadSeconds ?? 0.6;
  const hold = options.holdSeconds ?? 2.2;
  const minDuration = options.minDurationSeconds ?? 2;

  const valid = clicks
    .filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t <= duration && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)
    .sort((a, b) => a.t - b.t);

  const clusters: ClickEvent[][] = [];
  for (const click of valid) {
    const current = clusters[clusters.length - 1];
    const last = current?.[current.length - 1];
    if (current && last && click.t - last.t <= gap) current.push(click);
    else clusters.push([click]);
  }

  const segments: ZoomSegment[] = [];
  for (const cluster of clusters) {
    const first = cluster[0] as ClickEvent;
    const last = cluster[cluster.length - 1] as ClickEvent;
    let start = Math.max(0, first.t - lead);
    let end = Math.min(duration, last.t + hold);
    if (end - start < minDuration) end = Math.min(duration, start + minDuration);
    const previous = segments[segments.length - 1];
    if (previous && start < previous.end) start = previous.end;
    if (end - start < 1) continue;
    const focus = {
      x: round3(cluster.reduce((s, c) => s + c.x, 0) / cluster.length),
      y: round3(cluster.reduce((s, c) => s + c.y, 0) / cluster.length),
    };
    segments.push({ id: createId(), start: round3(start), end: round3(end), focus, scale, source: 'auto' });
  }
  return segments;
}
