import type { Request, Response } from 'express';
import type { WorkspaceRole } from '@spool/shared';
import { z } from 'zod';
import { membershipFor } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import * as users from '../services/user.service.js';
import { HttpError } from '../utils/http-error.js';

const nameSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80) });
const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  role: z.enum(['admin', 'member']).default('member'),
});

function roleOrThrow(req: Request): WorkspaceRole {
  const role = membershipFor(req.auth!.userId, String(req.params.workspaceId));
  if (!role) throw HttpError.notFound('Workspace not found');
  return role;
}

export function list(req: Request, res: Response) {
  res.json(users.listWorkspacesForUser(req.auth!.userId));
}

export function create(req: Request, res: Response) {
  const { name } = parse(nameSchema, req.body);
  res.status(201).json(users.createWorkspace(req.auth!.userId, name));
}

export function update(req: Request, res: Response) {
  const role = roleOrThrow(req);
  const { name } = parse(nameSchema, req.body);
  users.renameWorkspace(String(req.params.workspaceId), role, name);
  const workspace = users.listWorkspacesForUser(req.auth!.userId).find((w) => w.id === req.params.workspaceId);
  res.json(workspace);
}

export function members(req: Request, res: Response) {
  roleOrThrow(req);
  res.json(users.listMembers(String(req.params.workspaceId)));
}

export function invite(req: Request, res: Response) {
  const role = roleOrThrow(req);
  const input = parse(inviteSchema, req.body);
  res.status(201).json(users.addMember(String(req.params.workspaceId), role, input.email, input.role));
}

export function removeMember(req: Request, res: Response) {
  const role = roleOrThrow(req);
  users.removeMember(String(req.params.workspaceId), { userId: req.auth!.userId, role }, String(req.params.userId));
  res.status(204).end();
}
