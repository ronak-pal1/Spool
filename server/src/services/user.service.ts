import bcrypt from 'bcryptjs';
import type { AuthResponse, MeResponse, User, Workspace, WorkspaceMember, WorkspaceRole } from '@spool/shared';
import { db, nowIso } from '../db/index.js';
import { signUserToken } from '../middleware/auth.js';
import { createId, pickAvatarColor, slugify } from '../utils/ids.js';
import { HttpError } from '../utils/http-error.js';

/** Compared against when the email is unknown so response timing does not reveal registered accounts. */
const TIMING_GUARD_HASH = bcrypt.hashSync('spool-timing-guard', 12);

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  avatar_color: string;
  created_at: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  member_count: number;
}

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, avatarColor: row.avatar_color, createdAt: row.created_at };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, slug: row.slug, role: row.role, memberCount: row.member_count };
}

export function getUser(id: string): User {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) throw HttpError.notFound('User not found');
  return toUser(row);
}

export function listWorkspacesForUser(userId: string): Workspace[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.slug, m.role,
              (SELECT COUNT(*) FROM workspace_members mm WHERE mm.workspace_id = w.id) AS member_count
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = ?
        ORDER BY m.created_at ASC`,
    )
    .all(userId) as WorkspaceRow[];
  return rows.map(toWorkspace);
}

export function createWorkspace(userId: string, name: string): Workspace {
  const id = createId();
  const now = nowIso();
  db.transaction(() => {
    db.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run(id, name, slugify(name), now);
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(id, userId, 'owner', now);
  })();
  const workspace = listWorkspacesForUser(userId).find((w) => w.id === id);
  if (!workspace) throw new Error('Workspace creation failed');
  return workspace;
}

export async function register(input: { name: string; email: string; password: string }): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (existing) throw HttpError.conflict('An account with this email already exists');
  const id = createId();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const name = input.name.trim();
  db.prepare('INSERT INTO users (id, email, name, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    email,
    name,
    passwordHash,
    pickAvatarColor(email),
    nowIso(),
  );
  createWorkspace(id, `${name.split(' ')[0] ?? name}'s Workspace`);
  return { token: signUserToken(id), user: getUser(id), workspaces: listWorkspacesForUser(id) };
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email.trim().toLowerCase()) as UserRow | undefined;
  const valid = await bcrypt.compare(input.password, row?.password_hash ?? TIMING_GUARD_HASH);
  if (!row || !valid) throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials');
  return { token: signUserToken(row.id), user: toUser(row), workspaces: listWorkspacesForUser(row.id) };
}

export function me(userId: string): MeResponse {
  return { user: getUser(userId), workspaces: listWorkspacesForUser(userId) };
}

export async function updateProfile(
  userId: string,
  input: { name?: string; currentPassword?: string; newPassword?: string },
): Promise<MeResponse> {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!row) throw HttpError.notFound('User not found');
  if (input.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(input.name.trim(), userId);
  if (input.newPassword) {
    if (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, row.password_hash))) {
      throw HttpError.badRequest('Current password is incorrect');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(input.newPassword, 12), userId);
  }
  return me(userId);
}

export function renameWorkspace(workspaceId: string, role: WorkspaceRole, name: string): void {
  if (role === 'member') throw HttpError.forbidden('Only workspace admins can rename the workspace');
  db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), workspaceId);
}

export function listMembers(workspaceId: string): WorkspaceMember[] {
  const rows = db
    .prepare(
      `SELECT u.*, m.role, m.created_at AS joined_at
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`,
    )
    .all(workspaceId) as (UserRow & { role: WorkspaceRole; joined_at: string })[];
  return rows.map((row) => ({ user: toUser(row), role: row.role, joinedAt: row.joined_at }));
}

export function addMember(workspaceId: string, actorRole: WorkspaceRole, email: string, role: WorkspaceRole): WorkspaceMember {
  if (actorRole === 'member') throw HttpError.forbidden('Only workspace admins can invite members');
  if (role === 'owner') throw HttpError.badRequest('A workspace can only have one owner');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!user) throw HttpError.notFound('No Spool account exists for that email yet. Ask them to sign up first.');
  const existing = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, user.id);
  if (existing) throw HttpError.conflict('That person is already a member');
  const now = nowIso();
  db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, user.id, role, now);
  return { user: toUser(user), role, joinedAt: now };
}

export function removeMember(workspaceId: string, actor: { userId: string; role: WorkspaceRole }, userId: string): void {
  const target = db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as { role: WorkspaceRole } | undefined;
  if (!target) throw HttpError.notFound('Member not found');
  if (target.role === 'owner') throw HttpError.badRequest('The workspace owner cannot be removed');
  if (actor.userId !== userId && actor.role === 'member') throw HttpError.forbidden('Only workspace admins can remove members');
  db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
}
