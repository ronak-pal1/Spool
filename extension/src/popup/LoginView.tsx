import type { SystemStatus } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Pencil, Server } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createApi, errorMessage } from '@/lib/api';
import { normalizeUrl, writeSettings, type ExtensionSettings } from '@/lib/settings';
import { cn } from '@/ui/cn';
import { Button, Field, Logo, Segmented } from '@/ui/primitives';

type Health = { kind: 'checking' } | { kind: 'online'; status: SystemStatus } | { kind: 'offline'; message: string };

export function LoginView({ settings }: { settings: ExtensionSettings }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [editingServer, setEditingServer] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(settings.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>({ kind: 'checking' });

  const normalized = normalizeUrl(apiUrl);
  const api = useMemo(() => createApi(() => ({ ...settings, apiUrl: normalized, token: null })), [settings, normalized]);

  useEffect(() => {
    if (!normalized) {
      setHealth({ kind: 'offline', message: 'Enter your Spool server URL' });
      return;
    }
    setHealth({ kind: 'checking' });
    let alive = true;
    const timer = window.setTimeout(() => {
      api.health().then(
        (status) => alive && setHealth({ kind: 'online', status }),
        (err: unknown) => alive && setHealth({ kind: 'offline', message: errorMessage(err) }),
      );
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [api, normalized]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!normalized) {
      setEditingServer(true);
      setError('Enter your Spool server URL.');
      return;
    }
    setSubmitting(true);
    try {
      const status = health.kind === 'online' ? health.status : await api.health();
      const response =
        mode === 'login'
          ? await api.login({ email: email.trim(), password })
          : await api.register({ name: name.trim(), email: email.trim(), password });
      await writeSettings({
        apiUrl: normalized,
        webUrl: status.webUrl,
        token: response.token,
        user: response.user,
        workspaces: response.workspaces,
        activeWorkspaceId: response.workspaces[0]?.id ?? null,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = email.trim().length > 3 && password.length >= (mode === 'register' ? 8 : 1) && (mode === 'login' || name.trim().length > 0);

  return (
    <div className="px-5 pb-5 pt-6">
      <Logo />
      <h1 className="mt-5 text-[19px] font-semibold tracking-tight text-white">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-1 text-[13px] text-white/50">Record your screen and share a link with an AI summary in seconds.</p>

      <Segmented
        className="mt-5"
        value={mode}
        onChange={(value) => {
          setMode(value);
          setError(null);
        }}
        options={[
          { value: 'login', label: 'Sign in' },
          { value: 'register', label: 'Sign up' },
        ]}
      />

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="rounded-xl border border-white/[0.07] bg-ink-850/80 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Server className="h-3.5 w-3.5 shrink-0 text-white/35" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.12em] text-white/35">
                Server
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    health.kind === 'online' && 'bg-accent shadow-[0_0_8px_rgba(0,250,154,0.8)]',
                    health.kind === 'offline' && 'bg-danger',
                    health.kind === 'checking' && 'animate-pulse bg-white/30',
                  )}
                />
              </div>
              {!editingServer && <div className="truncate text-[12.5px] text-white/75">{normalized || 'Not configured'}</div>}
            </div>
            <button
              type="button"
              onClick={() => setEditingServer((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <Pencil className="h-3 w-3" />
              {editingServer ? 'Done' : 'Edit'}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {editingServer && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                <input
                  autoFocus
                  value={apiUrl}
                  onChange={(event) => setApiUrl(event.target.value)}
                  placeholder="https://api.spool.example"
                  spellCheck={false}
                  className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-ink-950/60 px-2.5 text-[13px] text-white placeholder:text-white/25 focus:border-accent/50 focus:outline-none"
                />
              </motion.div>
            )}
          </AnimatePresence>
          {health.kind === 'offline' && normalized && <p className="mt-1.5 text-[11.5px] leading-snug text-danger/90">{health.message}</p>}
        </div>

        <AnimatePresence initial={false}>
          {mode === 'register' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Ada Lovelace" />
            </motion.div>
          )}
        </AnimatePresence>
        <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
        />

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} disabled={!canSubmit}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
