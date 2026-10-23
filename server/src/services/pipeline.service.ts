import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { generateAutoZooms, type ClickEvent, type EditConfig } from '@spool/shared';
import { env } from '../config/env.js';
import { db, nowIso, parseJson } from '../db/index.js';
import { createId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { embed, embeddingsAvailable, llmAvailable, summarize, vectorToBuffer } from './ai.service.js';
import * as ffmpeg from './ffmpeg.service.js';
import { storage, storageKeys } from './s3.service.js';
import { chunkTranscript, transcribe, transcriptionAvailable, transcriptText } from './transcript.service.js';
import { editFor, getVideoRow, syncSearchIndex, updateVideoColumns, type VideoRow } from './video.service.js';

type JobKind = 'process' | 'ai' | 'render';

interface Job {
  kind: JobKind;
  videoId: string;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

async function withWorkdir<T>(videoId: string, task: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(env.tempDir, `${videoId}-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(dir, { recursive: true });
  try {
    return await task(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function videoExists(videoId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM videos WHERE id = ?').get(videoId));
}

async function processVideo(videoId: string): Promise<void> {
  const row = getVideoRow(videoId);
  await withWorkdir(videoId, async (dir) => {
    try {
      updateVideoColumns(videoId, { pipeline_stage: 'transcoding', pipeline_error: null });
      const sourcePath = path.join(dir, path.basename(row.source_key));
      await storage.downloadToFile(row.source_key, sourcePath);
      const sourceProbe = await ffmpeg.probe(sourcePath);
      if (!sourceProbe.hasVideo) throw new Error('The uploaded file does not contain a video stream');

      const playbackPath = path.join(dir, 'playback.mp4');
      await ffmpeg.normalize(sourcePath, playbackPath, sourceProbe);
      const playback = await ffmpeg.probe(playbackPath);
      if (playback.duration <= 0) throw new Error('Could not determine the video duration');

      const thumbPath = path.join(dir, 'thumbnail.jpg');
      const storyboardPath = path.join(dir, 'storyboard.jpg');
      await ffmpeg.thumbnail(playbackPath, thumbPath, playback.duration);
      const storyboardMeta = await ffmpeg.storyboard(playbackPath, storyboardPath, playback.duration, playback.width, playback.height);

      if (!videoExists(videoId)) return;
      await storage.uploadFile(storageKeys.playback(videoId), playbackPath, 'video/mp4');
      await storage.uploadFile(storageKeys.thumbnail(videoId), thumbPath, 'image/jpeg');
      await storage.uploadFile(storageKeys.storyboard(videoId), storyboardPath, 'image/jpeg');

      const fresh = getVideoRow(videoId);
      const clicks = parseJson<ClickEvent[]>(fresh.click_events, []);
      let edit: EditConfig = editFor({ ...fresh, duration: playback.duration });
      if (clicks.length > 0 && edit.zooms.length === 0) {
        edit = { ...edit, zooms: generateAutoZooms(clicks, playback.duration, createId) };
      }
      const playbackStats = await fsp.stat(playbackPath);
      updateVideoColumns(videoId, {
        status: 'ready',
        duration: playback.duration,
        width: playback.width,
        height: playback.height,
        size_bytes: playbackStats.size,
        playback_key: storageKeys.playback(videoId),
        thumbnail_key: storageKeys.thumbnail(videoId),
        storyboard_key: storageKeys.storyboard(videoId),
        storyboard_meta: JSON.stringify(storyboardMeta),
        edit_config: JSON.stringify(edit),
        pipeline_stage: transcriptionAvailable() ? 'transcribing' : 'complete',
        ai_status: transcriptionAvailable() ? 'processing' : 'unavailable',
      });
      logger.info({ videoId, duration: playback.duration }, 'video transcoded');
      await runAi(videoId, playbackPath, dir);
    } catch (error) {
      if (!videoExists(videoId)) return;
      logger.error({ err: error, videoId }, 'video processing failed');
      updateVideoColumns(videoId, { status: 'failed', pipeline_stage: 'failed', pipeline_error: describeError(error) });
    }
  });
}

async function runAi(videoId: string, playbackPath: string, dir: string): Promise<void> {
  if (!transcriptionAvailable()) {
    updateVideoColumns(videoId, { ai_status: 'unavailable', pipeline_stage: 'complete' });
    return;
  }
  try {
    updateVideoColumns(videoId, { ai_status: 'processing', pipeline_stage: 'transcribing', pipeline_error: null });
    const row = getVideoRow(videoId);
    const audio = await ffmpeg.extractAudio(playbackPath, path.join(dir, 'audio'), row.duration);
    const transcript = await transcribe(audio);
    if (!videoExists(videoId)) return;
    db.prepare(
      `INSERT INTO transcripts (video_id, language, provider, segments, full_text, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET language = excluded.language, provider = excluded.provider,
         segments = excluded.segments, full_text = excluded.full_text, created_at = excluded.created_at`,
    ).run(videoId, transcript.language, transcript.provider, JSON.stringify(transcript.segments), transcriptText(transcript), nowIso());
    syncSearchIndex(videoId);
    logger.info({ videoId, segments: transcript.segments.length }, 'transcription complete');

    const chunks = chunkTranscript(transcript);
    if (llmAvailable() && transcript.segments.length > 0) {
      updateVideoColumns(videoId, { pipeline_stage: 'summarizing' });
      const summary = await summarize(transcript, row.duration, row.title);
      if (!videoExists(videoId)) return;
      db.prepare(
        `INSERT INTO summaries (video_id, data, created_at) VALUES (?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`,
      ).run(videoId, JSON.stringify(summary), nowIso());
      const current = getVideoRow(videoId);
      if (current.title_is_default && summary.suggestedTitle) updateVideoColumns(videoId, { title: summary.suggestedTitle });
      syncSearchIndex(videoId);
    }

    updateVideoColumns(videoId, { pipeline_stage: 'indexing' });
    const vectors = embeddingsAvailable() && chunks.length > 0 ? await embed(chunks.map((c) => c.text)) : [];
    if (!videoExists(videoId)) return;
    db.transaction(() => {
      db.prepare('DELETE FROM transcript_chunks WHERE video_id = ?').run(videoId);
      const insert = db.prepare(
        'INSERT INTO transcript_chunks (id, video_id, start_time, end_time, text, embedding) VALUES (?, ?, ?, ?, ?, ?)',
      );
      chunks.forEach((chunk, i) => {
        const vector = vectors[i];
        insert.run(createId(), videoId, chunk.start, chunk.end, chunk.text, vector ? vectorToBuffer(vector) : null);
      });
    })();
    updateVideoColumns(videoId, { ai_status: 'ready', pipeline_stage: 'complete' });
    logger.info({ videoId }, 'AI enrichment complete');
  } catch (error) {
    if (!videoExists(videoId)) return;
    logger.error({ err: error, videoId }, 'AI enrichment failed');
    updateVideoColumns(videoId, { ai_status: 'failed', pipeline_stage: 'complete', pipeline_error: `AI: ${describeError(error)}` });
  }
}

async function reprocessAi(videoId: string): Promise<void> {
  const row = getVideoRow(videoId);
  if (!row.playback_key) return;
  await withWorkdir(videoId, async (dir) => {
    const playbackPath = path.join(dir, 'playback.mp4');
    try {
      await storage.downloadToFile(row.playback_key as string, playbackPath);
    } catch (error) {
      updateVideoColumns(videoId, { ai_status: 'failed', pipeline_stage: 'complete', pipeline_error: `AI: ${describeError(error)}` });
      return;
    }
    await runAi(videoId, playbackPath, dir);
  });
}

async function renderVideo(videoId: string): Promise<void> {
  const row = getVideoRow(videoId);
  if (!row.playback_key) {
    updateVideoColumns(videoId, { render_status: 'failed', render_error: 'Video is not ready yet' });
    return;
  }
  await withWorkdir(videoId, async (dir) => {
    try {
      updateVideoColumns(videoId, { render_status: 'rendering', render_error: null });
      const input = path.join(dir, 'playback.mp4');
      const output = path.join(dir, 'render.mp4');
      await storage.downloadToFile(row.playback_key as string, input);
      const meta = await ffmpeg.probe(input);
      await ffmpeg.render(input, output, editFor(row), meta);
      if (!videoExists(videoId)) return;
      const key = storageKeys.render(videoId, Date.now().toString(36));
      await storage.uploadFile(key, output, 'video/mp4');
      const previous = getVideoRow(videoId).render_key;
      updateVideoColumns(videoId, { render_status: 'ready', render_key: key, render_error: null });
      if (previous && previous !== key) {
        await storage.deletePrefix(previous).catch(() => undefined);
      }
      logger.info({ videoId }, 'render complete');
    } catch (error) {
      if (!videoExists(videoId)) return;
      logger.error({ err: error, videoId }, 'render failed');
      updateVideoColumns(videoId, { render_status: 'failed', render_error: describeError(error) });
    }
  });
}

class JobQueue {
  private readonly pending: Job[] = [];
  private readonly active = new Set<string>();

  constructor(private readonly concurrency: number) {}

  private key(job: Job): string {
    return `${job.kind}:${job.videoId}`;
  }

  enqueue(job: Job): void {
    const key = this.key(job);
    if (this.active.has(key) || this.pending.some((p) => this.key(p) === key)) return;
    this.pending.push(job);
    this.drain();
  }

  private drain(): void {
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const index = this.pending.findIndex((job) => ![...this.active].some((key) => key.endsWith(`:${job.videoId}`)));
      if (index === -1) return;
      const [job] = this.pending.splice(index, 1) as [Job];
      const key = this.key(job);
      this.active.add(key);
      this.execute(job)
        .catch((error: unknown) => logger.error({ err: error, job }, 'job crashed'))
        .finally(() => {
          this.active.delete(key);
          this.drain();
        });
    }
  }

  private execute(job: Job): Promise<void> {
    if (!videoExists(job.videoId)) return Promise.resolve();
    switch (job.kind) {
      case 'process':
        return processVideo(job.videoId);
      case 'ai':
        return reprocessAi(job.videoId);
      case 'render':
        return renderVideo(job.videoId);
    }
  }
}

const queue = new JobQueue(env.pipelineConcurrency);

export const pipeline = {
  process(videoId: string) {
    updateVideoColumns(videoId, { status: 'processing', pipeline_stage: 'queued' });
    queue.enqueue({ kind: 'process', videoId });
  },
  reprocessAi(videoId: string) {
    updateVideoColumns(videoId, { ai_status: 'processing', pipeline_stage: 'queued', pipeline_error: null });
    queue.enqueue({ kind: 'ai', videoId });
  },
  render(videoId: string) {
    updateVideoColumns(videoId, { render_status: 'queued', render_error: null });
    queue.enqueue({ kind: 'render', videoId });
  },
};

/** Re-queues work that was interrupted by a restart. */
export function resumeInterruptedJobs(): void {
  const rows = db
    .prepare(
      `SELECT id, status, ai_status, render_status FROM videos
        WHERE status = 'processing' OR (status = 'ready' AND ai_status = 'processing') OR render_status IN ('queued', 'rendering')`,
    )
    .all() as Pick<VideoRow, 'id' | 'status' | 'ai_status' | 'render_status'>[];
  for (const row of rows) {
    if (row.status === 'processing') queue.enqueue({ kind: 'process', videoId: row.id });
    else if (row.ai_status === 'processing') queue.enqueue({ kind: 'ai', videoId: row.id });
    if (row.render_status === 'queued' || row.render_status === 'rendering') queue.enqueue({ kind: 'render', videoId: row.id });
  }
  if (rows.length > 0) logger.info({ count: rows.length }, 'resumed interrupted jobs');
}

/** Removes uploads that were started but never completed (closed tab, crashed recorder) after 24h. */
export async function cleanupAbandonedUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = db.prepare(`SELECT * FROM videos WHERE status = 'uploading' AND created_at < ?`).all(cutoff) as VideoRow[];
  for (const row of rows) {
    try {
      if (row.upload_id) await storage.abortMultipartUpload(row.source_key, row.upload_id).catch(() => undefined);
      await storage.deletePrefix(storageKeys.prefix(row.id));
      db.prepare('DELETE FROM video_search WHERE video_id = ?').run(row.id);
      db.prepare('DELETE FROM videos WHERE id = ?').run(row.id);
      logger.info({ videoId: row.id }, 'removed abandoned upload');
    } catch (error) {
      logger.warn({ err: error, videoId: row.id }, 'failed to clean abandoned upload');
    }
  }
  await fsp.mkdir(env.tempDir, { recursive: true });
}
