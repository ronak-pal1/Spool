import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { WorkspaceRole } from '@spool/shared';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { HttpError } from '../utils/http-error.js';

export interface AuthContext {
  userId: string;
}

export interface WorkspaceContext {
  id: string;
  role: WorkspaceRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      workspace?: WorkspaceContext;
    }
  }
}

interface UserTokenPayload {
  sub: string;
  typ: 'user';
}

interface ShareTokenPayload {
  vid: string;
  typ: 'share';
}

export function signUserToken(userId: string): string {
  const payload: UserTokenPayload = { sub: userId, typ: 'user' };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30d', issuer: 'spool' });
}

export function signShareToken(videoId: string): { token: string; expiresAt: string } {
  const expiresInSeconds = 12 * 3600;
  const payload: ShareTokenPayload = { vid: videoId, typ: 'share' };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: expiresInSeconds, issuer: 'spool' });
  return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() };
}

export function verifyShareToken(token: string | undefined, videoId: string): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { issuer: 'spool' }) as Partial<ShareTokenPayload>;
    return payload.typ === 'share' && payload.vid === videoId;
  } catch {
    return false;
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Populates `req.auth` when a valid user token is present; never rejects. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwtSecret, { issuer: 'spool' }) as Partial<UserTokenPayload>;
      if (payload.typ === 'user' && typeof payload.sub === 'string') {
        const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(payload.sub);
        if (exists) req.auth = { userId: payload.sub };
      }
    } catch {
      req.auth = undefined;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw HttpError.unauthorized();
  next();
}

/** Resolves the active workspace from `X-Workspace-Id` (falling back to the user's first workspace). */
export function requireWorkspace(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) throw HttpError.unauthorized();
  const requested = req.header('x-workspace-id');
  const membership = (
    requested
      ? db.prepare('SELECT workspace_id, role FROM workspace_members WHERE user_id = ? AND workspace_id = ?').get(req.auth.userId, requested)
      : db
          .prepare('SELECT workspace_id, role FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
          .get(req.auth.userId)
  ) as { workspace_id: string; role: WorkspaceRole } | undefined;
  if (!membership) throw HttpError.forbidden('You are not a member of this workspace');
  req.workspace = { id: membership.workspace_id, role: membership.role };
  next();
}

export function membershipFor(userId: string, workspaceId: string): WorkspaceRole | null {
  const row = db
    .prepare('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?')
    .get(userId, workspaceId) as { role: WorkspaceRole } | undefined;
  return row?.role ?? null;
}
