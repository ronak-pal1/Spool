import type { Tag, VideoListItem } from '@spool/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input } from '../ui/Input';

export const TAG_COLORS = ['#00FA9A', '#38BDF8', '#A78BFA', '#F472B6', '#FB923C', '#FACC15', '#F87171', '#94A3B8'];

type VideoRef = Pick<VideoListItem, 'id' | 'title'> & { tags?: Tag[] };

export function RenameDialog({ video, onClose }: { video: VideoRef | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (video) setTitle(video.title);
  }, [video]);

  const mutation = useMutation({
    mutationFn: (next: string) => api.updateVideo(video!.id, { title: next }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.video(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      void queryClient.invalidateQueries({ queryKey: queryKeys.share(detail.shareId) });
      toast.success('Renamed');
      onClose();
    },
    onError: (error) => toast.error('Rename failed', errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (!next || !video) return;
    if (next === video.title) return onClose();
    mutation.mutate(next);
  };

  return (
    <Dialog
      open={Boolean(video)}
      onClose={onClose}
      title="Rename video"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="rename-form" loading={mutation.isPending} disabled={!title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="rename-form" onSubmit={submit}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Video title" data-autofocus onFocus={(e) => e.currentTarget.select()} />
      </form>
    </Dialog>
  );
}

export function DeleteDialog({ video, onClose, onDeleted }: { video: VideoRef | null; onClose: () => void; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteVideo(video!.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.video(video!.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Video deleted');
      onClose();
      onDeleted?.();
    },
    onError: (error) => toast.error('Delete failed', errorMessage(error)),
  });

  return (
    <Dialog
      open={Boolean(video)}
      onClose={onClose}
      title="Delete this video?"
      description="The recording, transcript, AI summary, chat history and analytics are permanently removed. Share links stop working immediately."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending} leftIcon={<Trash2 className="h-4 w-4" />}>
            Delete forever
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-4 py-3 text-sm font-medium text-white/85">{video?.title}</div>
    </Dialog>
  );
}

export function TagPickerDialog({ video, onClose }: { video: VideoRef | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const tags = useQuery({ queryKey: queryKeys.tags(workspaceId), queryFn: () => api.listTags(), enabled: Boolean(video) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0] as string);

  useEffect(() => {
    if (video) {
      setSelected(new Set((video.tags ?? []).map((t) => t.id)));
      setName('');
    }
  }, [video]);

  const create = useMutation({
    mutationFn: () => api.createTag(name.trim(), color),
    onSuccess: (tag) => {
      queryClient.setQueryData<Tag[]>(queryKeys.tags(workspaceId), (prev) => [...(prev ?? []), tag]);
      setSelected((prev) => new Set(prev).add(tag.id));
      setName('');
      setColor(TAG_COLORS[(TAG_COLORS.indexOf(color) + 1) % TAG_COLORS.length] as string);
    },
    onError: (error) => toast.error('Could not create tag', errorMessage(error)),
  });

  const save = useMutation({
    mutationFn: () => api.updateVideo(video!.id, { tagIds: [...selected] }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.video(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
      void queryClient.invalidateQueries({ queryKey: queryKeys.share(detail.shareId) });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tags updated');
      onClose();
    },
    onError: (error) => toast.error('Could not update tags', errorMessage(error)),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };

  const list = tags.data ?? [];

  return (
    <Dialog
      open={Boolean(video)}
      onClose={onClose}
      title="Tags"
      description="Organize recordings so teammates can filter the library."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {tags.isLoading && <p className="py-4 text-center text-sm text-white/40">Loading tags…</p>}
          {!tags.isLoading && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-white/45">
              <TagIcon className="h-5 w-5 text-white/30" />
              No tags yet. Create the first one below.
            </div>
          )}
          <AnimatePresence initial={false}>
            {list.map((tag) => {
              const active = selected.has(tag.id);
              return (
                <motion.button
                  key={tag.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => toggle(tag.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    active ? 'border-white/15 bg-white/[0.06] text-white' : 'border-transparent text-white/70 hover:bg-white/[0.04]',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color, boxShadow: `0 0 10px ${tag.color}80` }} />
                  <span className="flex-1 truncate">{tag.name}</span>
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors',
                      active ? 'border-accent bg-accent text-accent-foreground' : 'border-white/20',
                    )}
                  >
                    {active && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
        <form onSubmit={submitNew} className="space-y-2.5 rounded-xl border border-white/[0.07] bg-ink-900/50 p-3">
          <Field label="New tag">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Design review"
              trailing={
                <Button type="submit" size="xs" variant="subtle" loading={create.isPending} disabled={!name.trim()} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                  Add
                </Button>
              }
            />
          </Field>
          <div className="flex items-center gap-1.5">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className={cn('h-5 w-5 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-white/70 ring-offset-2 ring-offset-ink-850')}
                style={{ background: c }}
              />
            ))}
          </div>
        </form>
      </div>
    </Dialog>
  );
}
