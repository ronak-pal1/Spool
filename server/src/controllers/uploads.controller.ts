import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { parse } from '../middleware/validate.js';
import { pipeline } from '../services/pipeline.service.js';
import { localStorage, storage } from '../services/s3.service.js';
import * as videos from '../services/video.service.js';
import { HttpError } from '../utils/http-error.js';

const createSchema = z.object({
  title: z.string().trim().max(160).optional(),
  mimeType: z.string().min(3).max(120),
  source: z.enum(['extension', 'desktop', 'web', 'upload']),
});

const partsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(50),
});

const completeSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10000),
  durationHint: z.number().finite().min(0).optional(),
  clickEvents: z
    .array(z.object({ t: z.number().finite().min(0), x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }))
    .max(5000)
    .optional(),
});

function uploadingVideo(req: Request): videos.VideoRow {
  const row = videos.getVideoRow(String(req.params.videoId));
  if (row.owner_id !== req.auth!.userId) throw HttpError.notFound('Upload not found');
  if (row.status !== 'uploading' || !row.upload_id) throw HttpError.conflict('This upload has already been completed');
  return row;
}

export async function create(req: Request, res: Response) {
  const input = parse(createSchema, req.body);
  const row = await videos.createUploadingVideo({
    workspaceId: req.workspace!.id,
    ownerId: req.auth!.userId,
    title: input.title,
    mimeType: input.mimeType,
    source: input.source,
  });
  res.status(201).json({ videoId: row.id, shareId: row.share_id, uploadId: row.upload_id, partSize: env.storage.partSize });
}

export async function presignParts(req: Request, res: Response) {
  const row = uploadingVideo(req);
  const { partNumbers } = parse(partsSchema, req.body);
  const urls = await Promise.all(
    [...new Set(partNumbers)].map(async (partNumber) => ({
      partNumber,
      url: await storage.presignPart(row.source_key, row.upload_id as string, partNumber),
    })),
  );
  res.json({ urls });
}

export async function complete(req: Request, res: Response) {
  const row = uploadingVideo(req);
  const input = parse(completeSchema, req.body);
  const numbers = input.parts.map((p) => p.partNumber);
  if (new Set(numbers).size !== numbers.length) throw HttpError.badRequest('Duplicate part numbers');
  const size = await storage.completeMultipartUpload(row.source_key, row.upload_id as string, input.parts);
  if (size === 0) throw HttpError.badRequest('The uploaded video is empty');
  videos.updateVideoColumns(row.id, {
    upload_id: null,
    size_bytes: size,
    duration: input.durationHint ?? 0,
    click_events: JSON.stringify(input.clickEvents ?? []),
  });
  pipeline.process(row.id);
  const fresh = videos.getVideoRow(row.id);
  res.json(await videos.toDetail(fresh, videos.assertMemberAccess(fresh, req.auth!.userId, 'view')));
}

export async function abort(req: Request, res: Response) {
  const row = videos.getVideoRow(String(req.params.videoId));
  if (row.owner_id !== req.auth!.userId) throw HttpError.notFound('Upload not found');
  if (row.status !== 'uploading') throw HttpError.conflict('This upload has already been completed');
  await videos.deleteVideo(row);
  res.status(204).end();
}

/** Receives a part for the local storage driver; authorised by the signed URL handed out by presignParts. */
export async function localPart(req: Request, res: Response) {
  const local = localStorage();
  const uploadId = String(req.params.uploadId);
  const partNumber = Number(req.params.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw HttpError.badRequest('Invalid part number');
  const exp = Number(req.query.exp);
  const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;
  if (!local.verifyPartSignature(uploadId, partNumber, exp, sig)) throw HttpError.forbidden('The upload URL is invalid or expired');
  const owner = db.prepare('SELECT 1 FROM videos WHERE upload_id = ? AND status = ?').get(uploadId, 'uploading');
  if (!owner) throw HttpError.notFound('Upload not found or already completed');
  const etag = await local.writePart(uploadId, partNumber, req, 5 * 1024 * 1024 * 1024);
  res.setHeader('ETag', `"${etag}"`);
  res.status(200).end();
}
