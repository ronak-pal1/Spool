import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import * as system from './controllers/system.controller.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

const STATIC_ORIGINS = new Set([env.clientUrl, ...env.corsOrigins, 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);

function isAllowedOrigin(origin: string): boolean {
  if (STATIC_ORIGINS.has(origin)) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  if (!env.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) callback(null, true);
    else callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id', 'X-Share-Token', 'X-Viewer-Session', 'Range'],
  exposedHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  maxAge: 600,
};

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path.startsWith('/media/') || req.path.startsWith('/api/uploads/local/')) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'request');
    });
    next();
  });
  app.use(authenticate);

  app.get('/media/*key', system.media);
  app.use('/api', apiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
