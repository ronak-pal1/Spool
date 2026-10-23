import type { VideoAnalytics } from '@spool/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { HttpError } from '../utils/http-error.js';
import { createId } from '../utils/ids.js';
import type { VideoRow } from './video.service.js';

export const RETENTION_BUCKETS = 20;

interface ViewRow {
  id: string;
  video_id: string;
  viewer_id: string | null;
  session_id: string;
  watched_seconds: number;
  max_position: number;
  duration: number;
  buckets: string;
  completed: number;
  created_at: string;
  updated_at: string;
}

/** Starts (or resumes, within 30 minutes) a view for a viewer session. Creators never count their own views. */
export function startView(row: VideoRow, viewerId: string | null, sessionId: string): string | null {
  if (viewerId && viewerId === row.owner_id) return null;
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const existing = db
    .prepare('SELECT id FROM views WHERE video_id = ? AND session_id = ? AND updated_at > ? ORDER BY created_at DESC LIMIT 1')
    .get(row.id, sessionId, since) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = createId();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO views (id, video_id, viewer_id, session_id, duration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, row.id, viewerId, sessionId, row.duration, now, now);
    db.prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ?').run(row.id);
  })();
  return id;
}

export function recordHeartbeat(
  viewId: string,
  sessionId: string,
  input: { watchedSeconds: number; position: number; duration: number; buckets: number[] },
): void {
  const view = db.prepare('SELECT * FROM views WHERE id = ?').get(viewId) as ViewRow | undefined;
  if (!view || view.session_id !== sessionId) throw HttpError.notFound('View not found');
  const previous = parseJson<number[]>(view.buckets, []);
  const merged: number[] = Array.from({ length: RETENTION_BUCKETS }, (_, i) => ((previous[i] ?? 0) || (input.buckets[i] ?? 0) ? 1 : 0));
  const coverage = merged.reduce((sum: number, b) => sum + b, 0) / RETENTION_BUCKETS;
  const duration = input.duration > 0 ? input.duration : view.duration;
  const maxPosition = Math.max(view.max_position, Math.min(input.position, duration));
  const completed = coverage >= 0.9 || (duration > 0 && maxPosition >= duration * 0.95) ? 1 : 0;
  db.prepare(
    `UPDATE views SET watched_seconds = ?, max_position = ?, duration = ?, buckets = ?, completed = MAX(completed, ?), updated_at = ?
      WHERE id = ?`,
  ).run(
    Math.max(view.watched_seconds, Math.min(input.watchedSeconds, Math.max(duration, 1) * 4)),
    maxPosition,
    duration,
    JSON.stringify(merged),
    completed,
    nowIso(),
    viewId,
  );
}

export function getAnalytics(videoId: string): VideoAnalytics {
  const views = db.prepare('SELECT * FROM views WHERE video_id = ? ORDER BY created_at DESC').all(videoId) as ViewRow[];
  const totalViews = views.length;
  const viewers = new Set(views.map((v) => v.viewer_id ?? `session:${v.session_id}`));
  const totalWatchSeconds = views.reduce((sum, v) => sum + v.watched_seconds, 0);
  const completionValues = views.map((v) => {
    const buckets = parseJson<number[]>(v.buckets, []);
    return buckets.reduce((sum, b) => sum + (b ? 1 : 0), 0) / RETENTION_BUCKETS;
  });

  const retention = Array.from({ length: RETENTION_BUCKETS }, (_, i) => {
    if (totalViews === 0) return 0;
    const watched = views.filter((v) => (parseJson<number[]>(v.buckets, [])[i] ?? 0) > 0).length;
    return Math.round((watched / totalViews) * 1000) / 1000;
  });

  const days = 14;
  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay.set(date, 0);
  }
  for (const view of views) {
    const date = view.created_at.slice(0, 10);
    if (byDay.has(date)) byDay.set(date, (byDay.get(date) ?? 0) + 1);
  }

  const viewerIds = [...new Set(views.map((v) => v.viewer_id).filter((id): id is string => Boolean(id)))];
  const users = viewerIds.length
    ? (db
        .prepare(`SELECT id, name, avatar_color FROM users WHERE id IN (${viewerIds.map(() => '?').join(',')})`)
        .all(...viewerIds) as { id: string; name: string; avatar_color: string }[])
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    totalViews,
    uniqueViewers: viewers.size,
    totalWatchSeconds: Math.round(totalWatchSeconds),
    averageWatchSeconds: totalViews ? Math.round(totalWatchSeconds / totalViews) : 0,
    averageCompletion: totalViews ? Math.round((completionValues.reduce((a, b) => a + b, 0) / totalViews) * 1000) / 1000 : 0,
    completionRate: totalViews ? Math.round((views.filter((v) => v.completed).length / totalViews) * 1000) / 1000 : 0,
    viewsByDay: [...byDay.entries()].map(([date, count]) => ({ date, views: count })),
    retention,
    recentViewers: views.slice(0, 12).map((v, i) => {
      const user = v.viewer_id ? userMap.get(v.viewer_id) : undefined;
      return {
        name: user?.name ?? 'Anonymous viewer',
        avatarColor: user?.avatar_color ?? null,
        watchedPercent: Math.round((completionValues[i] ?? 0) * 100),
        viewedAt: v.created_at,
      };
    }),
  };
}
