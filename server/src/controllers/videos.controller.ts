import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../middleware/validate.js';
import { getAnalytics } from '../services/analytics.service.js';
import { pipeline } from '../services/pipeline.service.js';
import { transcriptionAvailable } from '../services/transcript.service.js';
import * as videos from '../services/video.service.js';
import { HttpError } from '../utils/http-error.js';

const listSchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(64).optional(),
  status: z.enum(['all', 'uploading', 'processing', 'ready', 'failed']).optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'views', 'duration']).optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1, 'Title cannot be empty').max(160).optional(),
    description: z.string().max(5000).optional(),
    visibility: z.enum(['public', 'password', 'workspace']).optional(),
    password: z.string().min(4, 'Password must be at least 4 characters').max(128).nullable().optional(),
    tagIds: z.array(z.string().max(64)).max(20).optional(),
  })
  .strict();

const range = z.object({ start: z.number().finite().min(0), end: z.number().finite().min(0) });
const point = z.object({ x: z.number().finite(), y: z.number().finite() });

export const editSchema = z.object({
  version: z.literal(1),
  trim: range,
  splits: z.array(z.number().finite().min(0)).max(500),
  cuts: z.array(range).max(500),
  blurs: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        start: z.number().finite().min(0),
        end: z.number().finite().min(0),
        rect: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }),
        intensity: z.number().finite(),
      }),
    )
    .max(100),
  zooms: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        start: z.number().finite().min(0),
        end: z.number().finite().min(0),
        focus: point,
        scale: z.number().finite(),
        source: z.enum(['auto', 'manual']),
      }),
    )
    .max(200),
});

function videoId(req: Request): string {
  return String(req.params.id);
}

async function detail(id: string, userId: string) {
  const row = videos.getVideoRow(id);
  const access = videos.assertMemberAccess(row, userId, 'view');
  return videos.toDetail(row, access);
}

export async function list(req: Request, res: Response) {
  const query = parse(listSchema, req.query);
  res.json(await videos.listVideos(req.workspace!.id, query));
}

export async function get(req: Request, res: Response) {
  res.json(await detail(videoId(req), req.auth!.userId));
}

export async function update(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'edit');
  await videos.updateVideo(row, parse(updateSchema, req.body));
  res.json(await detail(row.id, req.auth!.userId));
}

export async function remove(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'edit');
  await videos.deleteVideo(row);
  res.status(204).end();
}

export async function saveEdit(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'edit');
  videos.saveEdit(row, parse(editSchema, req.body));
  res.json(await detail(row.id, req.auth!.userId));
}

export async function render(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'edit');
  if (row.status !== 'ready') throw HttpError.conflict('The video is still processing');
  pipeline.render(row.id);
  res.status(202).json(await detail(row.id, req.auth!.userId));
}

export async function reprocess(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'edit');
  if (row.status === 'failed' && !row.playback_key) {
    pipeline.process(row.id);
  } else {
    if (row.status !== 'ready') throw HttpError.conflict('The video is still processing');
    if (!transcriptionAvailable()) throw HttpError.unavailable('No transcription provider is configured on the server');
    pipeline.reprocessAi(row.id);
  }
  res.status(202).json(await detail(row.id, req.auth!.userId));
}

export function analytics(req: Request, res: Response) {
  const row = videos.getVideoRow(videoId(req));
  videos.assertMemberAccess(row, req.auth!.userId, 'view');
  res.json(getAnalytics(row.id));
}
