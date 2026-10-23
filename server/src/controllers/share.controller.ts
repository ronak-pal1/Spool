import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import type { ChatStreamEvent, ShareResponse } from '@spool/shared';
import { z } from 'zod';
import { db } from '../db/index.js';
import { signShareToken } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { answerStream, llmAvailable } from '../services/ai.service.js';
import { recordHeartbeat, RETENTION_BUCKETS, startView } from '../services/analytics.service.js';
import * as chat from '../services/chat.service.js';
import * as videos from '../services/video.service.js';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

const unlockSchema = z.object({ password: z.string().min(1, 'Enter the password').max(128) });
const chatSchema = z.object({ message: z.string().trim().min(1, 'Ask a question').max(2000) });
const heartbeatSchema = z.object({
  watchedSeconds: z.number().finite().min(0),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  buckets: z.array(z.number().int().min(0).max(1)).max(RETENTION_BUCKETS),
});

function viewerSession(req: Request): string {
  const session = req.header('x-viewer-session');
  if (!session || !/^[A-Za-z0-9_-]{8,64}$/.test(session)) throw HttpError.badRequest('Missing viewer session');
  return session;
}

function accessible(req: Request) {
  const row = videos.findVideoByShareId(String(req.params.shareId));
  const access = videos.resolveAccess(row, { userId: req.auth?.userId, shareToken: req.header('x-share-token') });
  return { row, access };
}

function requireView(req: Request) {
  const result = accessible(req);
  if (!result.access.canView) {
    throw result.access.lockedReason === 'workspace'
      ? HttpError.unauthorized('This Spool is only available to workspace members')
      : HttpError.unauthorized('This Spool is password protected');
  }
  return result;
}

export async function get(req: Request, res: Response) {
  const { row, access } = accessible(req);
  if (!access.canView) {
    const owner = db.prepare('SELECT id, name, avatar_color FROM users WHERE id = ?').get(row.owner_id) as
      | { id: string; name: string; avatar_color: string }
      | undefined;
    const body: ShareResponse = {
      locked: true,
      reason: access.lockedReason ?? 'workspace',
      title: access.lockedReason === 'password' ? row.title : null,
      owner: access.lockedReason === 'password' && owner ? { id: owner.id, name: owner.name, avatarColor: owner.avatar_color } : null,
    };
    res.json(body);
    return;
  }
  const body: ShareResponse = { locked: false, video: await videos.toDetail(row, access) };
  res.json(body);
}

export async function unlock(req: Request, res: Response) {
  const row = videos.findVideoByShareId(String(req.params.shareId));
  const { password } = parse(unlockSchema, req.body);
  if (row.visibility !== 'password' || !row.password_hash) throw HttpError.badRequest('This Spool is not password protected');
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) throw new HttpError(401, 'Incorrect password', 'invalid_password');
  const { token, expiresAt } = signShareToken(row.id);
  res.json({ shareToken: token, expiresAt });
}

export function chatHistory(req: Request, res: Response) {
  const { row } = requireView(req);
  res.json(chat.history(row.id, chat.conversationKey(req.auth?.userId, viewerSession(req))));
}

export function clearChat(req: Request, res: Response) {
  const { row } = requireView(req);
  chat.clearHistory(row.id, chat.conversationKey(req.auth?.userId, viewerSession(req)));
  res.status(204).end();
}

export async function ask(req: Request, res: Response) {
  const { row } = requireView(req);
  if (!llmAvailable()) throw HttpError.unavailable('AI chat is not configured on this server');
  const { message } = parse(chatSchema, req.body);
  const key = chat.conversationKey(req.auth?.userId, viewerSession(req));
  let context: Awaited<ReturnType<typeof chat.buildAnswerContext>>;
  try {
    context = await chat.buildAnswerContext(row, message);
  } catch (error) {
    throw HttpError.conflict(error instanceof Error ? error.message : 'Transcript unavailable');
  }
  const prior = chat.history(row.id, key);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: ChatStreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let answer = '';
  try {
    for await (const delta of answerStream({ ...context, history: prior, question: message }, controller.signal)) {
      answer += delta;
      send({ type: 'delta', content: delta });
    }
    const trimmed = answer.trim() || "I couldn't find anything about that in this video.";
    const userMessage = chat.saveMessage(row.id, key, 'user', message);
    const assistant = chat.saveMessage(row.id, key, 'assistant', trimmed);
    send({ type: 'done', message: assistant, userMessage });
  } catch (error) {
    if (controller.signal.aborted) return;
    logger.error({ err: error, videoId: row.id }, 'chat stream failed');
    send({ type: 'error', error: 'The AI service failed to respond. Please try again.' });
  }
  res.end();
}

export function beginView(req: Request, res: Response) {
  const { row } = requireView(req);
  if (row.status !== 'ready') {
    res.json({ viewId: null });
    return;
  }
  res.json({ viewId: startView(row, req.auth?.userId ?? null, viewerSession(req)) });
}

export function heartbeat(req: Request, res: Response) {
  const input = parse(heartbeatSchema, req.body);
  recordHeartbeat(String(req.params.viewId), viewerSession(req), input);
  res.status(204).end();
}
