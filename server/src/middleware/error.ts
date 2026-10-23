import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  const typed = error as { type?: string; status?: number; message?: string };
  if (typed.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'bad_request' });
    return;
  }
  if (typed.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large', code: 'payload_too_large' });
    return;
  }
  logger.error({ err: error, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: 'Something went wrong on our side', code: 'internal_error' });
}
