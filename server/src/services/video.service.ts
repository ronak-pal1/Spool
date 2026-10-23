import bcrypt from 'bcryptjs';
import {
  createDefaultEdit,
  editedDuration,
  normalizeEdit,
  type AiStatus,
  type ClickEvent,
  type EditConfig,
  type ListVideosQuery,
  type PipelineStage,
  type RecordingSource,
  type RenderStatus,
  type StoryboardMeta,
  type Tag,
  type Transcript,
  type UpdateVideoRequest,
  type VideoDetail,
  type VideoListItem,
  type VideoStatus,
  type VideoSummary,
  type Visibility,
  type WorkspaceRole,
} from '@spool/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { membershipFor, verifyShareToken } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { createId, createShareId } from '../utils/ids.js';
import { llmAvailable } from './ai.service.js';
import { storage, storageKeys } from './s3.service.js';

export interface VideoRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  description: string;
  title_is_default: number;
  status: VideoStatus;
  source: RecordingSource;
  mime_type: string;
  source_key: string;
  upload_id: string | null;
  playback_key: string | null;
  thumbnail_key: string | null;
  storyboard_key: string | null;
  storyboard_meta: string | null;
  duration: number;
  width: number;
  height: number;
  size_bytes: number;
  edit_config: string | null;
  click_events: string;
  visibility: Visibility;
  password_hash: string | null;
  share_id: string;
  pipeline_stage: PipelineStage;
  pipeline_error: string | null;
  ai_status: AiStatus;
  render_status: RenderStatus;
  render_key: string | null;
  render_error: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

interface OwnerRow {
  id: string;
  name: string;
  avatar_color: string;
}

export interface VideoAccess {
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
  isMember: boolean;
  lockedReason: 'password' | 'workspace' | null;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/mp2t': 'ts',
  'video/x-msvideo': 'avi',
};

export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = MIME_EXTENSIONS[base];
  if (!extension) throw HttpError.badRequest(`Unsupported video type "${mime}"`);
  return extension;
}

export function getVideoRow(id: string): VideoRow {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;
  if (!row) throw HttpError.notFound('Video not found');
  return row;
}

export function findVideoByShareId(shareId: string): VideoRow {
  const row = db.prepare('SELECT * FROM videos WHERE share_id = ?').get(shareId) as VideoRow | undefined;
  if (!row) throw HttpError.notFound('This Spool does not exist or was deleted');
  return row;
}

export function updateVideoColumns(id: string, columns: Partial<Omit<VideoRow, 'id'>>): void {
  const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ');
  db.prepare(`UPDATE videos SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(entries),
    updated_at: nowIso(),
    id,
  });
}

export function editFor(row: VideoRow): EditConfig {
  const stored = parseJson<EditConfig | null>(row.edit_config, null);
  return stored ? normalizeEdit(stored, row.duration) : createDefaultEdit(row.duration);
}

export function resolveAccess(row: VideoRow, viewer: { userId?: string; shareToken?: string }): VideoAccess {
  const role: WorkspaceRole | null = viewer.userId ? membershipFor(viewer.userId, row.workspace_id) : null;
  if (role) {
    const elevated = row.owner_id === viewer.userId || role === 'owner' || role === 'admin';
    return { canView: true, canEdit: elevated, canManage: elevated, isMember: true, lockedReason: null };
  }
  if (row.visibility === 'public') return { canView: true, canEdit: false, canManage: false, isMember: false, lockedReason: null };
  if (row.visibility === 'password') {
    const unlocked = verifyShareToken(viewer.shareToken, row.id);
    return { canView: unlocked, canEdit: false, canManage: false, isMember: false, lockedReason: unlocked ? null : 'password' };
  }
  return { canView: false, canEdit: false, canManage: false, isMember: false, lockedReason: 'workspace' };
}

export function assertMemberAccess(row: VideoRow, userId: string, level: 'view' | 'edit'): VideoAccess {
  const access = resolveAccess(row, { userId });
  if (!access.isMember) throw HttpError.notFound('Video not found');
  if (level === 'edit' && !access.canEdit) throw HttpError.forbidden('Only the creator or a workspace admin can change this video');
  return access;
}

export function tagsForVideos(videoIds: string[]): Map<string, Tag[]> {
  const map = new Map<string, Tag[]>();
  if (videoIds.length === 0) return map;
  const placeholders = videoIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT vt.video_id, t.id, t.name, t.color FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
        WHERE vt.video_id IN (${placeholders}) ORDER BY t.name`,
    )
    .all(...videoIds) as { video_id: string; id: string; name: string; color: string }[];
  for (const row of rows) {
    const list = map.get(row.video_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.video_id, list);
  }
  return map;
}

function ownersFor(ids: string[]): Map<string, OwnerRow> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT id, name, avatar_color FROM users WHERE id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as OwnerRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function storyboardFor(row: VideoRow): Promise<StoryboardMeta | null> {
  if (!row.storyboard_key || !row.storyboard_meta) return null;
  const meta = parseJson<Omit<StoryboardMeta, 'url'> | null>(row.storyboard_meta, null);
  if (!meta) return null;
  return { ...meta, url: await storage.getReadUrl(row.storyboard_key) };
}

async function toListItemWith(row: VideoRow, tags: Tag[], owner: OwnerRow | undefined): Promise<VideoListItem> {
  const edit = editFor(row);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: row.source,
    durationSec: row.duration,
    editedDurationSec: row.duration > 0 ? editedDuration(edit) : 0,
    width: row.width,
    height: row.height,
    thumbnailUrl: row.thumbnail_key ? await storage.getReadUrl(row.thumbnail_key) : null,
    storyboard: await storyboardFor(row),
    visibility: row.visibility,
    shareId: row.share_id,
    viewCount: row.view_count,
    aiStatus: row.ai_status,
    pipelineStage: row.pipeline_stage,
    tags,
    owner: owner
      ? { id: owner.id, name: owner.name, avatarColor: owner.avatar_color }
      : { id: row.owner_id, name: 'Unknown', avatarColor: '#666666' },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function toListItems(rows: VideoRow[]): Promise<VideoListItem[]> {
  const tags = tagsForVideos(rows.map((r) => r.id));
  const owners = ownersFor(rows.map((r) => r.owner_id));
  return Promise.all(rows.map((row) => toListItemWith(row, tags.get(row.id) ?? [], owners.get(row.owner_id))));
}

export function getTranscript(videoId: string): Transcript | null {
  const row = db.prepare('SELECT language, provider, segments FROM transcripts WHERE video_id = ?').get(videoId) as
    | { language: string; provider: string; segments: string }
    | undefined;
  if (!row) return null;
  return { language: row.language, provider: row.provider, segments: parseJson(row.segments, []) };
}

export function getSummary(videoId: string): VideoSummary | null {
  const row = db.prepare('SELECT data FROM summaries WHERE video_id = ?').get(videoId) as { data: string } | undefined;
  return row ? parseJson<VideoSummary | null>(row.data, null) : null;
}

export async function toDetail(row: VideoRow, access: VideoAccess): Promise<VideoDetail> {
  const [item] = await toListItems([row]);
  if (!item) throw new Error('Failed to map video');
  const transcript = getTranscript(row.id);
  const safeName = `${row.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'spool'}.mp4`;
  return {
    ...item,
    description: row.description,
    workspaceId: row.workspace_id,
    playbackUrl: row.playback_key ? await storage.getReadUrl(row.playback_key) : null,
    edit: editFor(row),
    clickEvents: access.canEdit ? parseJson<ClickEvent[]>(row.click_events, []) : [],
    transcript,
    summary: getSummary(row.id),
    pipelineError: access.canEdit ? row.pipeline_error : row.pipeline_error ? 'Processing failed' : null,
    hasPassword: Boolean(row.password_hash),
    renderStatus: row.render_status,
    renderUrl: row.render_key ? await storage.getReadUrl(row.render_key, { downloadName: safeName }) : null,
    renderError: access.canEdit ? row.render_error : null,
    permissions: {
      canEdit: access.canEdit,
      canManage: access.canManage,
      canChat: access.canView && llmAvailable() && Boolean(transcript && transcript.segments.length > 0),
    },
  };
}

export async function listVideos(workspaceId: string, query: ListVideosQuery): Promise<VideoListItem[]> {
  const where: string[] = ['v.workspace_id = @workspaceId'];
  const params: Record<string, unknown> = { workspaceId };
  if (query.status && query.status !== 'all') {
    where.push('v.status = @status');
    params.status = query.status;
  }
  if (query.tag) {
    where.push('EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id AND vt.tag_id = @tag)');
    params.tag = query.tag;
  }
  if (query.q && query.q.trim()) {
    const fts = toFtsQuery(query.q);
    if (fts) {
      where.push(`(v.title LIKE @like OR v.id IN (SELECT video_id FROM video_search WHERE video_search MATCH @fts))`);
      params.fts = fts;
    } else {
      where.push('v.title LIKE @like');
    }
    params.like = `%${query.q.trim().replace(/[%_]/g, '')}%`;
  }
  const order: Record<NonNullable<ListVideosQuery['sort']>, string> = {
    newest: 'v.created_at DESC',
    oldest: 'v.created_at ASC',
    title: 'v.title COLLATE NOCASE ASC',
    views: 'v.view_count DESC, v.created_at DESC',
    duration: 'v.duration DESC',
  };
  const rows = db
    .prepare(`SELECT v.* FROM videos v WHERE ${where.join(' AND ')} ORDER BY ${order[query.sort ?? 'newest']} LIMIT 500`)
    .all(params) as VideoRow[];
  return toListItems(rows);
}

export function toFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export function defaultTitle(source: RecordingSource): string {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const label = source === 'upload' ? 'Upload' : 'Recording';
  return `${label} · ${date}`;
}

export async function createUploadingVideo(input: {
  workspaceId: string;
  ownerId: string;
  title?: string;
  mimeType: string;
  source: RecordingSource;
}): Promise<VideoRow> {
  const id = createId();
  const extension = extensionForMime(input.mimeType);
  const key = storageKeys.source(id, extension);
  const contentType = input.mimeType.split(';')[0] as string;
  const uploadId = await storage.createMultipartUpload(key, contentType);
  const now = nowIso();
  const title = input.title?.trim() || defaultTitle(input.source);
  db.prepare(
    `INSERT INTO videos (id, workspace_id, owner_id, title, title_is_default, status, source, mime_type, source_key, upload_id,
                         share_id, pipeline_stage, created_at, updated_at)
     VALUES (@id, @workspaceId, @ownerId, @title, @titleIsDefault, 'uploading', @source, @mime, @key, @uploadId,
             @shareId, 'uploading', @now, @now)`,
  ).run({
    id,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    title,
    titleIsDefault: 1,
    source: input.source,
    mime: contentType,
    key,
    uploadId,
    shareId: createShareId(),
    now,
  });
  syncSearchIndex(id);
  return getVideoRow(id);
}

export async function updateVideo(row: VideoRow, input: UpdateVideoRequest): Promise<void> {
  const columns: Partial<VideoRow> = {};
  if (input.title !== undefined) {
    columns.title = input.title.trim();
    columns.title_is_default = 0;
  }
  if (input.description !== undefined) columns.description = input.description.trim();
  if (input.visibility !== undefined) {
    if (input.visibility === 'password' && !input.password && !row.password_hash) {
      throw HttpError.badRequest('Set a password to protect this link');
    }
    columns.visibility = input.visibility;
  }
  if (input.password !== undefined) {
    columns.password_hash = input.password ? await bcrypt.hash(input.password, 10) : null;
  }
  const finalVisibility = columns.visibility ?? row.visibility;
  const finalPassword = columns.password_hash !== undefined ? columns.password_hash : row.password_hash;
  if (finalVisibility === 'password' && !finalPassword) throw HttpError.badRequest('Set a password to protect this link');

  db.transaction(() => {
    updateVideoColumns(row.id, columns);
    if (input.tagIds) {
      const unique = [...new Set(input.tagIds)];
      if (unique.length > 0) {
        const valid = db
          .prepare(`SELECT id FROM tags WHERE workspace_id = ? AND id IN (${unique.map(() => '?').join(',')})`)
          .all(row.workspace_id, ...unique) as { id: string }[];
        if (valid.length !== unique.length) throw HttpError.badRequest('One or more tags do not belong to this workspace');
      }
      db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(row.id);
      const insert = db.prepare('INSERT INTO video_tags (video_id, tag_id) VALUES (?, ?)');
      for (const tagId of unique) insert.run(row.id, tagId);
    }
  })();
  if (columns.title !== undefined) syncSearchIndex(row.id);
}

export async function deleteVideo(row: VideoRow): Promise<void> {
  if (row.upload_id && row.status === 'uploading') {
    await storage.abortMultipartUpload(row.source_key, row.upload_id).catch(() => undefined);
  }
  await storage.deletePrefix(storageKeys.prefix(row.id));
  db.transaction(() => {
    db.prepare('DELETE FROM video_search WHERE video_id = ?').run(row.id);
    db.prepare('DELETE FROM videos WHERE id = ?').run(row.id);
  })();
}

export function saveEdit(row: VideoRow, edit: EditConfig): void {
  if (row.status !== 'ready') throw HttpError.conflict('The video is still processing');
  const normalized = normalizeEdit(edit, row.duration);
  if (editedDuration(normalized) < 0.5) throw HttpError.badRequest('The edit must keep at least half a second of video');
  updateVideoColumns(row.id, { edit_config: JSON.stringify(normalized) });
}

export function syncSearchIndex(videoId: string): void {
  const row = db.prepare('SELECT title FROM videos WHERE id = ?').get(videoId) as { title: string } | undefined;
  if (!row) return;
  const transcript = db.prepare('SELECT full_text FROM transcripts WHERE video_id = ?').get(videoId) as { full_text: string } | undefined;
  const summary = getSummary(videoId);
  const summaryText = summary
    ? [summary.tldr, ...summary.takeaways, ...summary.topics, ...summary.chapters.map((c) => `${c.title} ${c.summary}`)].join(' ')
    : '';
  db.transaction(() => {
    db.prepare('DELETE FROM video_search WHERE video_id = ?').run(videoId);
    db.prepare('INSERT INTO video_search (video_id, title, transcript, summary) VALUES (?, ?, ?, ?)').run(
      videoId,
      row.title,
      transcript?.full_text ?? '',
      summaryText,
    );
  })();
}

export function listTags(workspaceId: string): Tag[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS video_count
         FROM tags t WHERE t.workspace_id = ? ORDER BY t.name COLLATE NOCASE`,
    )
    .all(workspaceId) as { id: string; name: string; color: string; video_count: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, videoCount: r.video_count }));
}

export function createTag(workspaceId: string, name: string, color: string): Tag {
  const trimmed = name.trim();
  const existing = db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(workspaceId, trimmed);
  if (existing) throw HttpError.conflict('A tag with that name already exists');
  const id = createId();
  db.prepare('INSERT INTO tags (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, trimmed, color, nowIso());
  return { id, name: trimmed, color, videoCount: 0 };
}

export function deleteTag(workspaceId: string, tagId: string): void {
  const result = db.prepare('DELETE FROM tags WHERE id = ? AND workspace_id = ?').run(tagId, workspaceId);
  if (result.changes === 0) throw HttpError.notFound('Tag not found');
}
