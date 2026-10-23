import path from 'node:path';
import type { Request, Response } from 'express';
import type { SystemStatus } from '@spool/shared';
import { env } from '../config/env.js';
import { localStorage } from '../services/s3.service.js';
import { searchWorkspace } from '../services/search.service.js';
import { HttpError } from '../utils/http-error.js';

export function health(_req: Request, res: Response) {
  const body: SystemStatus = {
    ok: true,
    version: '1.0.0',
    storage: env.storage.driver,
    transcription: env.ai.transcriptionProvider,
    llm: env.ai.llmProvider ? `${env.ai.llmProvider}:${env.ai.llmModel}` : null,
    embeddings: env.ai.llmProvider ? `${env.ai.llmProvider}:${env.ai.embeddingModel}` : null,
    maxRecordingSeconds: env.maxRecordingSeconds,
    webUrl: env.clientUrl.replace(/\/+$/, ''),
  };
  res.json(body);
}

export async function search(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  res.json(await searchWorkspace(req.workspace!.id, q));
}

/** Streams media for the local storage driver with HTTP Range support; access is granted by the URL signature. */
export function media(req: Request, res: Response) {
  const local = localStorage();
  const raw = req.params.key as unknown;
  const key = Array.isArray(raw) ? raw.join('/') : String(raw);
  const exp = Number(req.query.exp);
  const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;
  const download = typeof req.query.download === 'string' ? req.query.download : '';
  if (!local.verifyReadSignature(key, exp, download, sig)) throw HttpError.forbidden('This media link is invalid or expired');
  const filePath = local.resolvePath(key);
  if (download) res.attachment(download);
  res.sendFile(path.basename(filePath), {
    root: path.dirname(filePath),
    maxAge: '1h',
    acceptRanges: true,
    headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' },
  }, (error) => {
    if (error && !res.headersSent) {
      res.status((error as { status?: number }).status ?? 404).json({ error: 'Media not found', code: 'not_found' });
    }
  });
}
