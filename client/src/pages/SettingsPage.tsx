import { formatRelativeTime, type WorkspaceRole } from '@spool/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, Building2, Check, Chrome, Copy, Cpu, KeyRound, Monitor, Server, Trash2, User as UserIcon, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Menu } from '@/components/ui/Menu';
import { Avatar, Badge, Skeleton } from '@/components/ui/misc';
import { api, API_URL, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCopyFeedback, useDocumentTitle } from '@/lib/hooks';
import { useActiveWorkspace, useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

export function SettingsPage() {
  useDocumentTitle('Settings');
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-8 sm:px-8">
      <p className="label">Settings</p>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight text-white">Account & workspace</h1>
      <div className="mt-8 space-y-6">
        <ProfileCard />
        <PasswordCard />
        <WorkspaceCard />
        <MembersCard />
        <ServerCard />
      </div>
    </div>
  );
}

function Card({ title, description, icon, children, delay = 0 }: { title: string; description?: string; icon: ReactNode; children: ReactNode; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 30, delay }}
      className="surface overflow-hidden"
    >
      <div className="flex items-start gap-3 border-b border-white/[0.05] px-6 py-4">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/60">{icon}</span>
        <div>
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-white/45">{description}</p>}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </motion.section>
  );
}

function ProfileCard() {
  const user = useAuthStore((s) => s.user);
  const setProfile = useAuthStore((s) => s.setProfile);
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name ?? '');
  useEffect(() => setName(user?.name ?? ''), [user?.name]);

  const mutation = useMutation({
    mutationFn: () => api.updateMe({ name: name.trim() }),
    onSuccess: (me) => {
      setProfile(me.user, me.workspaces);
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      toast.success('Profile updated');
    },
    onError: (error) => toast.error('Could not update profile', errorMessage(error)),
  });

  if (!user) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && name.trim() !== user.name) mutation.mutate();
  };

  return (
    <Card title="Profile" description="How you appear to viewers and teammates." icon={<UserIcon className="h-4 w-4" />}>
      <form onSubmit={submit} className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Avatar name={name || user.name} color={user.avatarColor} size={56} />
        <div className="grid flex-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email">
            <Input value={user.email} disabled icon={<AtSign className="h-4 w-4" />} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={mutation.isPending} disabled={!name.trim() || name.trim() === user.name}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.updateMe({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed');
    },
    onError: (error) => toast.error('Could not change password', errorMessage(error)),
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (current && next.length >= 8 && next === confirm) mutation.mutate();
  };

  return (
    <Card title="Password" icon={<KeyRound className="h-4 w-4" />} delay={0.04}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" error={tooShort ? 'At least 8 characters' : null}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" invalid={tooShort} />
        </Field>
        <Field label="Confirm" error={mismatch ? "Passwords don't match" : null}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" invalid={mismatch} />
        </Field>
        <div className="sm:col-span-3 sm:flex sm:justify-end">
          <Button type="submit" variant="secondary" loading={mutation.isPending} disabled={!current || next.length < 8 || next !== confirm}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WorkspaceCard() {
  const workspace = useActiveWorkspace();
  const user = useAuthStore((s) => s.user);
  const setProfile = useAuthStore((s) => s.setProfile);
  const queryClient = useQueryClient();
  const [name, setName] = useState(workspace?.name ?? '');
  useEffect(() => setName(workspace?.name ?? ''), [workspace?.id, workspace?.name]);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  const mutation = useMutation({
    mutationFn: () => api.updateWorkspace(workspace!.id, name.trim()),
    onSuccess: (updated) => {
      if (user) setProfile(user, useAuthStore.getState().workspaces.map((w) => (w.id === updated.id ? updated : w)));
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Workspace renamed');
    },
    onError: (error) => toast.error('Could not rename workspace', errorMessage(error)),
  });

  if (!workspace) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && name.trim() !== workspace.name) mutation.mutate();
  };

  return (
    <Card title="Workspace" description={`You are ${workspace.role === 'owner' ? 'the owner' : `a${workspace.role === 'admin' ? 'n admin' : ' member'}`} of this workspace.`} icon={<Building2 className="h-4 w-4" />} delay={0.08}>
      <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Workspace name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!canManage} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="URL slug">
            <Input value={workspace.slug} disabled />
          </Field>
        </div>
        {canManage && (
          <Button type="submit" variant="secondary" loading={mutation.isPending} disabled={!name.trim() || name.trim() === workspace.name}>
            Rename
          </Button>
        )}
      </form>
    </Card>
  );
}

const ROLE_TONE: Record<WorkspaceRole, 'accent' | 'info' | 'neutral'> = { owner: 'accent', admin: 'info', member: 'neutral' };

function MembersCard() {
  const workspace = useActiveWorkspace();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  const members = useQuery({
    queryKey: queryKeys.members(workspace?.id ?? ''),
    queryFn: () => api.listMembers(workspace!.id),
    enabled: Boolean(workspace),
  });

  const invite = useMutation({
    mutationFn: () => api.inviteMember(workspace!.id, email.trim(), role),
    onSuccess: (member) => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace!.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success(`${member.user.name} joined ${workspace!.name}`);
    },
    onError: (error) => toast.error('Could not add member', errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(workspace!.id, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace!.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Member removed');
    },
    onError: (error) => toast.error('Could not remove member', errorMessage(error)),
  });

  if (!workspace) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) invite.mutate();
  };

  return (
    <Card title="Members" description="Teammates can watch workspace-only videos and browse the shared library." icon={<Users className="h-4 w-4" />} delay={0.12}>
      {canManage && (
        <form onSubmit={submit} className="mb-5 flex flex-col gap-2 sm:flex-row">
          <Input
            className="flex-1"
            type="email"
            placeholder="teammate@company.com"
            icon={<AtSign className="h-4 w-4" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Menu
            items={[
              { label: 'Member', checked: role === 'member', onSelect: () => setRole('member') },
              { label: 'Admin', checked: role === 'admin', onSelect: () => setRole('admin') },
            ]}
            trigger={(props) => (
              <Button {...props} variant="subtle" className="capitalize">
                {role}
              </Button>
            )}
          />
          <Button type="submit" variant="primary" leftIcon={<UserPlus className="h-4 w-4" />} loading={invite.isPending} disabled={!email.trim()}>
            Add
          </Button>
        </form>
      )}
      {canManage && <p className="-mt-3 mb-4 text-xs text-white/35">Teammates need a Spool account with this email before you can add them.</p>}
      <div className="divide-y divide-white/[0.05]">
        {members.isLoading &&
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        <AnimatePresence initial={false}>
          {members.data?.map((member) => (
            <motion.div
              key={member.user.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-3 overflow-hidden py-3"
            >
              <Avatar name={member.user.name} color={member.user.avatarColor} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/90">
                  {member.user.name}
                  {member.user.id === user?.id && <span className="ml-2 text-xs font-normal text-white/35">You</span>}
                </p>
                <p className="truncate text-xs text-white/40">
                  {member.user.email} · joined {formatRelativeTime(member.joinedAt)}
                </p>
              </div>
              <Badge tone={ROLE_TONE[member.role]} className="capitalize">
                {member.role}
              </Badge>
              {canManage && member.role !== 'owner' && member.user.id !== user?.id && (
                <button
                  onClick={() => remove.mutate(member.user.id)}
                  className="rounded-lg p-1.5 text-white/30 transition hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove ${member.user.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Card>
  );
}

function ServerCard() {
  const health = useQuery({ queryKey: queryKeys.health, queryFn: () => api.health(), staleTime: 30_000 });
  const [copied, copy] = useCopyFeedback();
  const data = health.data;
  const rows: { label: string; value: string | null; ok: boolean }[] = data
    ? [
        { label: 'Storage', value: data.storage === 's3' ? 'Amazon S3 (direct multipart)' : 'Local disk', ok: true },
        { label: 'Transcription', value: data.transcription, ok: Boolean(data.transcription) },
        { label: 'Language model', value: data.llm, ok: Boolean(data.llm) },
        { label: 'Embeddings', value: data.embeddings, ok: Boolean(data.embeddings) },
        { label: 'Recording limit', value: `${Math.round(data.maxRecordingSeconds / 60)} minutes`, ok: true },
      ]
    : [];

  return (
    <Card title="Server & apps" description="Connect the Chrome extension and desktop app to this Spool server." icon={<Server className="h-4 w-4" />} delay={0.16}>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-1.5 pl-3">
        <span className="label shrink-0">API URL</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/80">{API_URL}</span>
        <Button size="sm" variant="subtle" onClick={() => copy(API_URL, 'API URL copied')} leftIcon={copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] p-3.5">
          <Chrome className="mt-0.5 h-4 w-4 text-white/50" />
          <div className="text-xs leading-relaxed text-white/50">
            <p className="text-[13px] font-medium text-white/85">Chrome extension</p>
            Load <code className="font-mono text-white/70">extension/dist</code> unpacked, open the popup and sign in with this API URL.
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] p-3.5">
          <Monitor className="mt-0.5 h-4 w-4 text-white/50" />
          <div className="text-xs leading-relaxed text-white/50">
            <p className="text-[13px] font-medium text-white/85">Desktop app</p>
            Native capture with system audio, camera bubble and auto-zoom. Paste the API URL on first launch.
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {health.isLoading && <Skeleton className="h-24 w-full" />}
        {health.isError && (
          <p className="flex items-center gap-2 text-sm text-danger">
            <X className="h-4 w-4" /> {errorMessage(health.error)}
          </p>
        )}
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-white/50">
              <Cpu className="h-3.5 w-3.5 text-white/25" />
              {row.label}
            </span>
            <span className={cn('flex items-center gap-2', row.ok ? 'text-white/80' : 'text-white/35')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', row.ok ? 'bg-accent shadow-[0_0_8px_rgba(0,250,154,0.8)]' : 'bg-white/25')} />
              {row.value ?? 'Not configured'}
            </span>
          </div>
        ))}
        {data && <p className="pt-1 text-right font-mono text-2xs text-white/25">Spool server v{data.version}</p>}
      </div>
    </Card>
  );
}
