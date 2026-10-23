import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import * as share from '../controllers/share.controller.js';
import * as system from '../controllers/system.controller.js';
import * as tags from '../controllers/tags.controller.js';
import * as uploads from '../controllers/uploads.controller.js';
import * as videos from '../controllers/videos.controller.js';
import * as workspaces from '../controllers/workspace.controller.js';
import { requireAuth, requireWorkspace } from '../middleware/auth.js';

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const unlockLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

export function apiRouter(): Router {
  const router = Router();

  router.get('/health', system.health);

  router.post('/auth/register', authLimiter, auth.register);
  router.post('/auth/login', authLimiter, auth.login);
  router.get('/auth/me', requireAuth, auth.me);
  router.patch('/auth/me', requireAuth, auth.updateMe);

  router.get('/workspaces', requireAuth, workspaces.list);
  router.post('/workspaces', requireAuth, workspaces.create);
  router.patch('/workspaces/:workspaceId', requireAuth, workspaces.update);
  router.get('/workspaces/:workspaceId/members', requireAuth, workspaces.members);
  router.post('/workspaces/:workspaceId/members', requireAuth, workspaces.invite);
  router.delete('/workspaces/:workspaceId/members/:userId', requireAuth, workspaces.removeMember);

  router.get('/videos', requireAuth, requireWorkspace, videos.list);
  router.get('/videos/:id', requireAuth, videos.get);
  router.patch('/videos/:id', requireAuth, videos.update);
  router.delete('/videos/:id', requireAuth, videos.remove);
  router.put('/videos/:id/edit', requireAuth, videos.saveEdit);
  router.post('/videos/:id/render', requireAuth, videos.render);
  router.post('/videos/:id/reprocess', requireAuth, videos.reprocess);
  router.get('/videos/:id/analytics', requireAuth, videos.analytics);

  router.get('/tags', requireAuth, requireWorkspace, tags.list);
  router.post('/tags', requireAuth, requireWorkspace, tags.create);
  router.delete('/tags/:id', requireAuth, requireWorkspace, tags.remove);

  router.get('/search', requireAuth, requireWorkspace, system.search);

  router.put('/uploads/local/:uploadId/:partNumber', uploads.localPart);
  router.post('/uploads', requireAuth, requireWorkspace, uploads.create);
  router.post('/uploads/:videoId/parts', requireAuth, uploads.presignParts);
  router.post('/uploads/:videoId/complete', requireAuth, uploads.complete);
  router.delete('/uploads/:videoId', requireAuth, uploads.abort);

  router.get('/share/:shareId', share.get);
  router.post('/share/:shareId/unlock', unlockLimiter, share.unlock);
  router.get('/share/:shareId/chat', share.chatHistory);
  router.delete('/share/:shareId/chat', share.clearChat);
  router.post('/share/:shareId/chat', chatLimiter, share.ask);
  router.post('/share/:shareId/views', share.beginView);
  router.patch('/views/:viewId', share.heartbeat);

  return router;
}
