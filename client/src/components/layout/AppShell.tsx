import type { Tag } from '@spool/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  ChevronsUpDown,
  Library,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings,
  Trash2,
  UploadCloud,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useActiveWorkspace, useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useUiStore } from '@/store/ui.store';
import { ACCEPTED_VIDEO, useUploadsStore } from '@/store/uploads.store';
import { DropOverlay, UploadTray } from '../dashboard/UploadTray';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Input';
import { Menu, type MenuEntry } from '../ui/Menu';
import { Avatar, Kbd, Logo } from '../ui/misc';
import { CommandPalette } from './CommandPalette';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function AppShell() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const setProfile = useAuthStore((s) => s.setProfile);

  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api.me(), staleTime: 60_000 });
  useEffect(() => {
    if (me.data) setProfile(me.data.user, me.data.workspaces);
  }, [me.data, setProfile]);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="flex h-full min-h-0 bg-ink-900">
      <aside className="hidden w-[248px] shrink-0 border-r border-white/[0.06] bg-ink-950/60 lg:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-[70] lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              className="absolute inset-y-0 left-0 w-[264px] border-r border-white/10 bg-ink-900 shadow-pop"
            >
              <button
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-white/50 hover:bg-white/5 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
              <Sidebar />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 lg:hidden">
          <button onClick={() => setDrawerOpen(true)} className="rounded-lg p-2 text-white/70 hover:bg-white/5" aria-label="Open navigation">
            <MenuIcon className="h-5 w-5" />
          </button>
          <Logo />
          <button
            onClick={() => useUiStore.getState().setPaletteOpen(true)}
            className="rounded-lg p-2 text-white/70 hover:bg-white/5"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <UploadTray />
      <DropOverlay />
    </div>
  );
}

function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);
  const logout = useAuthStore((s) => s.logout);
  const workspace = useActiveWorkspace();
  const uploadFile = useUploadsStore((s) => s.uploadFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const activeTag = location.pathname === '/library' ? searchParams.get('tag') : null;

  const tags = useQuery({
    queryKey: queryKeys.tags(workspace?.id ?? null),
    queryFn: () => api.listTags(),
    enabled: Boolean(workspace),
  });

  const deleteTag = useMutation({
    mutationFn: (tag: Tag) => api.deleteTag(tag.id),
    onSuccess: (_, tag) => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      toast.success(`Deleted tag “${tag.name}”`);
      if (activeTag === tag.id) navigate('/library');
    },
    onError: (error) => toast.error('Could not delete tag', errorMessage(error)),
  });

  const switchWorkspace = (id: string) => {
    if (id === workspace?.id) return;
    setActiveWorkspace(id);
    navigate('/library');
  };

  const workspaceItems: MenuEntry[] = [
    { heading: 'Workspaces' },
    ...workspaces.map((w) => ({
      label: w.name,
      icon: <Building2 className="h-3.5 w-3.5" />,
      checked: w.id === workspace?.id,
      onSelect: () => switchWorkspace(w.id),
    })),
    'separator',
    { label: 'Create workspace', icon: <Plus className="h-3.5 w-3.5" />, onSelect: () => setCreateOpen(true) },
    { label: 'Workspace settings', icon: <Settings className="h-3.5 w-3.5" />, onSelect: () => navigate('/settings') },
  ];

  const signOut = () => {
    logout();
    queryClient.clear();
    navigate('/login');
  };

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="px-2 pb-4">
        <Logo />
      </div>

      <Menu
        align="start"
        className="w-[224px]"
        items={workspaceItems}
        trigger={(props) => (
          <button
            {...props}
            className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent/30 to-accent/5 text-xs font-semibold text-accent ring-1 ring-accent/30">
              {workspace?.name.slice(0, 1).toUpperCase() ?? 'S'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{workspace?.name ?? 'Workspace'}</span>
              <span className="block text-2xs capitalize text-white/40">
                {workspace ? `${workspace.role} · ${workspace.memberCount} ${workspace.memberCount === 1 ? 'member' : 'members'}` : '—'}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-white/35 group-hover:text-white/60" />
          </button>
        )}
      />

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <Button variant="primary" size="sm" leftIcon={<Video className="h-4 w-4" />} onClick={() => navigate('/record')}>
          New recording
        </Button>
        <Button variant="subtle" size="icon-sm" aria-label="Upload a video" title="Upload a video" onClick={() => fileRef.current?.click()}>
          <UploadCloud className="h-4 w-4" />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_VIDEO}
          multiple
          className="hidden"
          onChange={(event) => {
            for (const file of Array.from(event.target.files ?? [])) uploadFile(file);
            event.target.value = '';
          }}
        />
      </div>

      <button
        onClick={() => useUiStore.getState().setPaletteOpen(true)}
        className="mt-3 flex h-9 items-center gap-2 rounded-xl border border-white/[0.07] bg-ink-850 px-3 text-[13px] text-white/40 transition-colors hover:border-white/15 hover:text-white/70"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search transcripts…</span>
        <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <nav className="mt-5 space-y-0.5">
        <SidebarLink to="/library" icon={<Library className="h-4 w-4" />} end>
          Library
        </SidebarLink>
        <SidebarLink to="/record" icon={<Video className="h-4 w-4" />}>
          Record
        </SidebarLink>
        <SidebarLink to="/settings" icon={<Settings className="h-4 w-4" />}>
          Settings
        </SidebarLink>
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <div className="label flex items-center justify-between px-2.5 pb-2">Tags</div>
        {tags.data && tags.data.length === 0 && <p className="px-2.5 text-xs leading-relaxed text-white/30">Add tags from a video's menu to organize your library.</p>}
        <div className="space-y-0.5">
          {tags.data?.map((tag) => {
            const active = activeTag === tag.id;
            return (
              <div key={tag.id} className="group/tag relative">
                <button
                  onClick={() => navigate(active ? '/library' : `/library?tag=${tag.id}`)}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                    active ? 'text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85',
                  )}
                >
                  {active && (
                    <motion.span layoutId="sidebar-tag" className="absolute inset-0 rounded-lg bg-white/[0.06]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                  )}
                  <span className="relative h-2 w-2 rounded-full" style={{ background: tag.color, boxShadow: `0 0 8px ${tag.color}90` }} />
                  <span className="relative flex-1 truncate text-left">{tag.name}</span>
                  <span className="tabular relative text-2xs text-white/30 group-hover/tag:opacity-0">{tag.videoCount ?? 0}</span>
                </button>
                <button
                  onClick={() => deleteTag.mutate(tag)}
                  aria-label={`Delete tag ${tag.name}`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/30 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover/tag:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {user && (
        <Menu
          align="start"
          className="w-[224px]"
          items={[
            { heading: user.email },
            { label: 'Account settings', icon: <Settings className="h-3.5 w-3.5" />, onSelect: () => navigate('/settings') },
            'separator',
            { label: 'Sign out', icon: <LogOut className="h-3.5 w-3.5" />, onSelect: signOut, danger: true },
          ]}
          trigger={(props) => (
            <button {...props} className="mt-3 flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.04]">
              <Avatar name={user.name} color={user.avatarColor} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white/90">{user.name}</span>
                <span className="block truncate text-2xs text-white/40">{user.email}</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-white/30" />
            </button>
          )}
        />
      )}

      <CreateWorkspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function SidebarLink({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors', isActive ? 'text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="sidebar-nav"
              className="absolute inset-0 rounded-lg border border-white/[0.07] bg-white/[0.06]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className={cn('relative transition-colors', isActive && 'text-accent')}>{icon}</span>
          <span className="relative">{children}</span>
        </>
      )}
    </NavLink>
  );
}

function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setActiveWorkspace = useAuthStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.createWorkspace(name.trim()),
    onSuccess: (workspace) => {
      if (user) setProfile(user, [...useAuthStore.getState().workspaces, workspace]);
      setActiveWorkspace(workspace.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success(`Created ${workspace.name}`);
      onClose();
      navigate('/library');
    },
    onError: (error) => toast.error('Could not create workspace', errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a workspace"
      description="Workspaces keep a team's recordings, tags and members together."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="create-workspace" loading={mutation.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form id="create-workspace" onSubmit={submit}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Acme Design" data-autofocus />
        </Field>
      </form>
    </Dialog>
  );
}
