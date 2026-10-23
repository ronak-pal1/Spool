const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Smallest "nice" tick interval that keeps labels at least `minPx` apart. */
export function tickStep(pxPerSecond: number, minPx = 72): number {
  for (const step of TICK_STEPS) if (step * pxPerSecond >= minPx) return step;
  return TICK_STEPS[TICK_STEPS.length - 1] as number;
}

export function formatRulerLabel(seconds: number, step: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (step < 1) return `${m}:${s.toFixed(step < 0.5 ? 2 : 1).padStart(step < 0.5 ? 5 : 4, '0')}`;
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
}

/** Precise editor readout, e.g. 1:04.25 */
export function formatPrecise(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Accepts "83.5", "1:23.5" or "0:01:23.5". Returns null for invalid input. */
export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Snaps `value` to the nearest candidate within `thresholdSeconds`, otherwise returns it unchanged. */
export function snap(value: number, candidates: number[], thresholdSeconds: number): number {
  let best = value;
  let bestDistance = thresholdSeconds;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
