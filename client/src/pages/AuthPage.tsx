import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, AtSign, KeyRound, MessageSquareText, Scissors, Sparkles, User as UserIcon, Wand2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/Tabs';
import { api, errorMessage, queryClient, queryKeys } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { useAuthStore } from '@/store/auth.store';

type Mode = 'login' | 'register';

const FEATURES = [
  { icon: <Sparkles className="h-4 w-4" />, title: 'AI summaries & chapters', body: 'Every recording is transcribed with word-level timing and summarized in seconds.' },
  { icon: <MessageSquareText className="h-4 w-4" />, title: 'Ask the video', body: 'Viewers ask questions and get answers that jump straight to the moment.' },
  { icon: <Wand2 className="h-4 w-4" />, title: 'Auto zoom on clicks', body: 'Cursor clicks become smooth, cinematic zooms you can fine-tune.' },
  { icon: <Scissors className="h-4 w-4" />, title: 'Non-destructive editing', body: 'Trim, cut, split and blur sensitive data without re-uploading.' },
];

export function AuthPage({ initialMode }: { initialMode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const setSession = useAuthStore((s) => s.setSession);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const from = (location.state as { from?: string } | null)?.from ?? '/library';
  useDocumentTitle(mode === 'login' ? 'Sign in' : 'Create account');

  const health = useQuery({ queryKey: queryKeys.health, queryFn: () => api.health(), staleTime: 60_000, retry: 1 });

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login({ email: email.trim(), password })
        : api.register({ name: name.trim(), email: email.trim(), password }),
    onSuccess: (session) => {
      queryClient.clear();
      setSession(session);
      navigate(from, { replace: true });
    },
  });

  if (token) return <Navigate to={from} replace />;

  const switchMode = (next: Mode) => {
    setMode(next);
    mutation.reset();
    navigate(next === 'login' ? '/login' : '/register', { replace: true, state: location.state });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const passwordTooShort = mode === 'register' && password.length > 0 && password.length < 8;
  const canSubmit = email.trim() && password && (mode === 'login' || (name.trim() && password.length >= 8));

  return (
    <div className="relative flex min-h-full overflow-hidden bg-ink-950">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade bg-[size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-[120px]" />

      <section className="relative hidden flex-1 flex-col justify-between p-12 lg:flex">
        <Logo />
        <div className="max-w-lg">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            className="text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-white"
          >
            Say it once.
            <br />
            <span className="bg-gradient-to-r from-accent via-accent-200 to-white bg-clip-text text-transparent">Let the video do the meeting.</span>
          </motion.h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
            Record your screen and camera, share a link, and let Spool transcribe, summarize and answer questions about it.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-3">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 26, delay: 0.1 + i * 0.07 }}
                className="glass rounded-2xl p-4"
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">{feature.icon}</div>
                <p className="text-sm font-medium text-white">{feature.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/45">{feature.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <p className="text-xs text-white/30">© {new Date().getFullYear()} Spool. Async video for teams that ship.</p>
      </section>

      <section className="relative flex flex-1 items-center justify-center p-6 lg:max-w-[560px] lg:border-l lg:border-white/[0.06] lg:bg-ink-900/40 lg:backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="mt-1.5 text-sm text-white/45">{mode === 'login' ? 'Sign in to your Spool workspace.' : 'Start recording in under a minute.'}</p>

          <Segmented
            className="mt-6 w-full [&>button]:flex-1"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'login', label: 'Sign in' },
              { value: 'register', label: 'Sign up' },
            ]}
          />

          <form onSubmit={submit} className="mt-6 space-y-4">
            <AnimatePresence initial={false}>
              {mode === 'register' && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                  className="overflow-hidden"
                >
                  <Field label="Full name">
                    <Input icon={<UserIcon className="h-4 w-4" />} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" maxLength={80} />
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
            <Field label="Email">
              <Input
                icon={<AtSign className="h-4 w-4" />}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field label="Password" error={passwordTooShort ? 'Use at least 8 characters' : null}>
              <Input
                icon={<KeyRound className="h-4 w-4" />}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? '••••••••' : 'At least 8 characters'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                invalid={passwordTooShort}
              />
            </Field>

            <AnimatePresence>
              {mutation.error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2.5 text-[13px] text-danger"
                >
                  {errorMessage(mutation.error)}
                </motion.p>
              )}
            </AnimatePresence>

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={mutation.isPending} disabled={!canSubmit} rightIcon={<ArrowRight className="h-4 w-4" />}>
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-white/35">
            <span className={health.data?.ok ? 'h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,250,154,0.9)]' : health.isError ? 'h-1.5 w-1.5 rounded-full bg-danger' : 'h-1.5 w-1.5 rounded-full bg-white/30'} />
            {health.data?.ok ? `Connected to Spool server v${health.data.version}` : health.isError ? 'Cannot reach the Spool server' : 'Connecting…'}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
