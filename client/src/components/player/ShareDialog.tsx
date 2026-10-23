import type { VideoDetail, Visibility } from '@spool/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, Check, Code2, Copy, Globe2, KeyRound, Link2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/hooks';
import { shareUrl } from '@/lib/viewer';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Switch } from '../ui/misc';

const OPTIONS: { value: Visibility; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'public', label: 'Anyone with the link', description: 'No sign-in required', icon: <Globe2 className="h-4 w-4" /> },
  { value: 'password', label: 'Password protected', description: 'Viewers must enter a password', icon: <KeyRound className="h-4 w-4" /> },
  { value: 'workspace', label: 'Workspace only', description: 'Only members of your workspace', icon: <Building2 className="h-4 w-4" /> },
];

export function ShareDialog({ open, onClose, video }: { open: boolean; onClose: () => void; video: VideoDetail }) {
  const queryClient = useQueryClient();
  const sourceTime = usePlayerStore((s) => s.sourceTime);
  const [visibility, setVisibility] = useState<Visibility>(video.visibility);
  const [password, setPassword] = useState('');
  const [atTime, setAtTime] = useState(false);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);

  useEffect(() => {
    if (open) {
      setVisibility(video.visibility);
      setPassword('');
      setCopied(null);
    }
  }, [open, video.visibility]);

  const mutation = useMutation({
    mutationFn: (input: { visibility: Visibility; password?: string }) => api.updateVideo(video.id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.share(video.shareId), { locked: false, video: updated });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      toast.success('Sharing updated');
      setPassword('');
    },
    onError: (error) => toast.error('Could not update sharing', errorMessage(error)),
  });

  const link = shareUrl(video.shareId, atTime ? sourceTime : undefined);
  const embedSrc = link.replace(`/s/${video.shareId}`, `/embed/${video.shareId}`);
  const embed = `<iframe src="${embedSrc}" width="960" height="540" frameborder="0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`;

  const copy = async (kind: 'link' | 'embed') => {
    const ok = await copyText(kind === 'link' ? link : embed, kind === 'link' ? 'Link copied' : 'Embed code copied');
    if (!ok) return;
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const needsPassword = visibility === 'password' && !video.hasPassword;
  const dirty = visibility !== video.visibility || (visibility === 'password' && password.length > 0);

  return (
    <Dialog open={open} onClose={onClose} title="Share this Spool" description="Control who can watch, then copy the link.">
      <div className="space-y-5">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-1.5 pl-3">
          <Link2 className="h-4 w-4 shrink-0 text-white/40" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/75">{link}</span>
          <Button size="sm" variant="primary" onClick={() => void copy('link')} leftIcon={copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied === 'link' ? 'copied' : 'copy'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </motion.span>
            </AnimatePresence>
          </Button>
        </div>
        <label className="flex items-center justify-between text-[13px] text-white/60">
          Start at current time
          <Switch checked={atTime} onChange={setAtTime} label="Start at current time" />
        </label>

        {video.permissions.canManage && (
          <div className="space-y-2">
            <p className="label">Who can watch</p>
            <div className="space-y-1.5">
              {OPTIONS.map((option) => {
                const active = visibility === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setVisibility(option.value)}
                    className={cn(
                      'relative flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                      active ? 'border-accent/40 bg-accent/[0.06]' : 'border-white/[0.07] hover:border-white/15 hover:bg-white/[0.02]',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg border transition',
                        active ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/[0.04] text-white/50',
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className="flex-1">
                      <span className="block text-[13.5px] font-medium text-white">{option.label}</span>
                      <span className="block text-xs text-white/45">{option.description}</span>
                    </span>
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border transition', active ? 'border-accent' : 'border-white/20')}>
                      {active && <motion.span layoutId="share-radio" className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence initial={false}>
              {visibility === 'password' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="pt-1.5">
                    <Input
                      type="password"
                      icon={<Lock className="h-4 w-4" />}
                      placeholder={video.hasPassword ? 'Enter a new password to change it' : 'Set a password (min 4 characters)'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant={dirty ? 'primary' : 'secondary'}
                disabled={!dirty || (needsPassword && password.length < 4) || (password.length > 0 && password.length < 4)}
                loading={mutation.isPending}
                onClick={() => mutation.mutate({ visibility, ...(password ? { password } : {}) })}
              >
                Save access
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="label">Embed</p>
          <div className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-ink-900/60 p-3">
            <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-white/35" />
            <code className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-2xs text-white/50">{embed}</code>
            <button onClick={() => void copy('embed')} className="shrink-0 rounded-lg p-1.5 text-white/45 transition hover:bg-white/5 hover:text-white" aria-label="Copy embed code">
              {copied === 'embed' ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
