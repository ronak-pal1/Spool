import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../middleware/validate.js';
import * as videos from '../services/video.service.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #00FA9A'),
});

export function list(req: Request, res: Response) {
  res.json(videos.listTags(req.workspace!.id));
}

export function create(req: Request, res: Response) {
  const input = parse(createSchema, req.body);
  res.status(201).json(videos.createTag(req.workspace!.id, input.name, input.color));
}

export function remove(req: Request, res: Response) {
  videos.deleteTag(req.workspace!.id, String(req.params.id));
  res.status(204).end();
}
