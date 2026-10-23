export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${ss}`;
  return `${minutes.toString().padStart(2, '0')}:${ss}`;
}

export function formatDurationLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function parseTimestampToSeconds(value: string): number | null {
  const parts = value.trim().split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts as [number, number];
    if (s > 59) return null;
    return m * 60 + s;
  }
  const [h, m, s] = parts as [number, number, number];
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

export type RichTextToken = { type: 'text'; value: string } | { type: 'timestamp'; value: string; seconds: number };

const TIMESTAMP_PATTERN = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/** Splits AI output into plain text and `[mm:ss]` / `[h:mm:ss]` citation tokens. */
export function tokenizeTimestamps(text: string): RichTextToken[] {
  const tokens: RichTextToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
    const index = match.index ?? 0;
    const raw = match[1] as string;
    const seconds = parseTimestampToSeconds(raw);
    if (seconds === null) continue;
    if (index > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, index) });
    tokens.push({ type: 'timestamp', value: raw, seconds });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ''}${(parts[parts.length - 1] as string)[0] ?? ''}`.toUpperCase();
}
