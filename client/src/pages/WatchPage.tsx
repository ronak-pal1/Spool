import {
  ApiError,
  editedDuration,
  formatRelativeTime,
  formatTimestamp,
  type ShareGateResponse,
  type VideoDetail,
} from '@spool/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BarChart3,
  Copy,
  Download,
  Eye,
  FileText,
  Film,
  Globe2,
  KeyRound,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Scissors,
  Share2,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';
import { DeleteDialog, TagPickerDialog } from '@/components/dashboard/VideoDialogs';
import { AnalyticsPanel } from '@/components/player/AnalyticsPanel';
import { ProcessingState } from '@/components/player/ProcessingState';
import { ShareDialog } from '@/components/player/ShareDialog';
import { SummaryPanel } from '@/components/player/SummaryPanel';
import { TranscriptPanel } from '@/components/player/TranscriptPanel';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Menu, type MenuEntry } from '@/components/ui/Menu';
import { Avatar, Badge, EmptyState, Logo, Spinner } from '@/components/ui/misc';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { copyText, useDocumentTitle } from '@/lib/hooks';
import { useViewTracking } from '@/lib/useViewTracking';
import { getShareToken, setShareToken, shareUrl } from '@/lib/viewer';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';

type PanelTab = 'transcript' | 'summary' | 'chat' | 'analytics';

function needsPolling(video: VideoDetail): boolean {
  return (
    video.status === 'uploading' ||
    video.status === 'processing' ||
    video.aiStatus === 'processing' ||
    (video.aiStatus === 'pending' && video.pipelineStage !== 'complete' && video.status === 'ready') ||
    video.renderStatus === 'queued' ||
    video.renderStatus === 'rendering'
  );
}

export function WatchPage() {
  const { shareId = '' } = useParams();
  const [tokenVersion, setTokenVersion] = useState(0);
  const shareToken = useMemo(() => getShareToken(shareId), [shareId, tokenVersion]);

  const share = useQuery({
    queryKey: queryKeys.share(shareId),
    queryFn: () => api.getShare(shareId, getShareToken(shareId)),
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && !data.locked && needsPolling(data.video) ? 3000 : false;
    },
  });

  useDocumentTitle(share.data && !share.data.locked ? share.data.video.title : share.data?.locked ? (share.data.title ?? 'Protected video') : null);

  if (share.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (share.isError || !share.data) {
    const notFound = share.error instanceof ApiError && share.error.status === 404;
    return (
      <div className="flex h-full flex-col">
        <MinimalHeader />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title={notFound ? 'This video does not exist' : "Couldn't load this video"}
            description={notFound ? 'The link may be mistyped, or the video was deleted by its creator.' : errorMessage(share.error)}
            action={
              notFound ? (
                <Link to="/">
                  <Button variant="secondary">Go home</Button>
                </Link>
              ) : (
                <Button variant="secondary" onClick={() => void share.refetch()}>
                  Try again
                </Button>
              )
            }
          />
        </div>
      </div>
    );
  }

  if (share.data.locked) {
    return (
      <ShareGate
        shareId={shareId}
        gate={share.data}
        onUnlocked={() => {
          setTokenVersion((v) => v + 1);
          void share.refetch();
        }}
      />
    );
  }

  return <WatchView key={share.data.video.id} video={share.data.video} shareToken={shareToken} />;
}

function MinimalHeader() {
  const token = useAuthStore((s) => s.token);
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
      <Link to={token ? '/library' : '/'}>
        <Logo />
      </Link>
      {!token && (
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/register">
            <Button variant="primary" size="sm">
              Try Spool free
            </Button>
          </Link>
        </div>
      )}
    </header>
  );
}

function ShareGate({ shareId, gate, onUnlocked }: { shareId: string; gate: ShareGateResponse; onUnlocked: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(0);
  const unlock = useMutation({
    mutationFn: () => api.unlockShare(shareId, password),
    onSuccess: (result) => {
      setShareToken(shareId, result.shareToken, result.expiresAt);
      onUnlocked();
    },
    onError: () => setShake((s) => s + 1),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) unlock.mutate();
  };

  return (
    <div className="flex min-h-full flex-col bg-ink-950">
      <MinimalHeader />
      <div className="relative flex flex-1 items-center justify-center p-6">
        <div className="pointer-events-none absolute inset-0 bg-accent-radial opacity-70" />
        <motion.div
          key={shake}
          initial={shake ? { x: 0 } : { opacity: 0, y: 16 }}
          animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : { opacity: 1, y: 0 }}
          transition={shake ? { duration: 0.4 } : { type: 'spring', stiffness: 260, damping: 26 }}
          className="glass relative w-full max-w-sm rounded-3xl p-7 shadow-pop"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-glow">
            {gate.reason === 'password' ? <KeyRound className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <h1 className="mt-5 text-center text-lg font-semibold text-white">{gate.title ?? 'Protected video'}</h1>
          {gate.owner && (
            <p className="mt-1.5 flex items-center justify-center gap-2 text-sm text-white/45">
              <Avatar name={gate.owner.name} color={gate.owner.avatarColor} size={18} />
              Shared by {gate.owner.name}
            </p>
          )}

          {gate.reason === 'password' ? (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                invalid={unlock.isError}
                icon={<KeyRound className="h-4 w-4" />}
              />
              {unlock.isError && <p className="text-xs text-danger">{errorMessage(unlock.error)}</p>}
              <Button type="submit" variant="primary" className="w-full" loading={unlock.isPending} disabled={!password}>
                Unlock video
              </Button>
            </form>
          ) : (
            <div className="mt-6 space-y-3 text-center">
              <p className="text-sm leading-relaxed text-white/50">
                {token ? "This video is only available to members of the creator's workspace. Ask them to invite you." : 'This video is only available to workspace members. Sign in to continue.'}
              </p>
              {!token && (
                <Link to="/login" state={{ from: `/s/${shareId}` }} className="block">
                  <Button variant="primary" className="w-full">
                    Sign in
                  </Button>
                </Link>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function WatchView({ video, shareToken }: { video: VideoDetail; shareToken: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const [searchParams] = useSearchParams();
  const initialTime = useMemo(() => {
    const t = Number(searchParams.get('t'));
    return Number.isFinite(t) && t > 0 ? t : undefined;
  }, [searchParams]);
  const [tab, setTab] = useState<PanelTab>(() => (video.transcript ? 'transcript' : 'summary'));
  const [shareOpen, setShareOpen] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const length = useMemo(() => editedDuration(video.edit), [video.edit]);
  const tracker = useViewTracking(video.shareId, shareToken, video.edit, length);
  const resetPlayer = usePlayerStore((s) => s.setTime);
  const { canEdit, canManage, canChat } = video.permissions;
  const playable = video.status === 'ready' && Boolean(video.playbackUrl);

  useEffect(() => {
    resetPlayer(initialTime ?? 0);
  }, [resetPlayer, initialTime]);

  const applyDetail = useCallback(
    (detail: VideoDetail) => {
      queryClient.setQueryData(queryKeys.share(detail.shareId), { locked: false, video: detail });
      queryClient.setQueryData(queryKeys.video(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
    },
    [queryClient],
  );

  const reprocess = useMutation({
    mutationFn: () => api.reprocessAi(video.id),
    onSuccess: (detail) => {
      applyDetail(detail);
      toast.info(video.status === 'failed' ? 'Processing restarted' : 'Regenerating transcript and summary');
    },
    onError: (error) => toast.error('Could not reprocess', errorMessage(error)),
  });

  const render = useMutation({
    mutationFn: () => api.renderVideo(video.id),
    onSuccess: (detail) => {
      applyDetail(detail);
      toast.info('Exporting edited video', 'We will let you know when the MP4 is ready.');
    },
    onError: (error) => toast.error('Export failed to start', errorMessage(error)),
  });

  const previousRender = useRef(video.renderStatus);
  useEffect(() => {
    if (previousRender.current !== video.renderStatus) {
      if (video.renderStatus === 'ready' && (previousRender.current === 'rendering' || previousRender.current === 'queued')) toast.success('Export ready', 'Your edited MP4 can be downloaded now.');
      if (video.renderStatus === 'failed') toast.error('Export failed', video.renderError ?? undefined);
      previousRender.current = video.renderStatus;
    }
  }, [video.renderStatus, video.renderError]);

  const rendering = video.renderStatus === 'queued' || video.renderStatus === 'rendering';
  const hasEdits =
    video.edit.cuts.length > 0 ||
    video.edit.blurs.length > 0 ||
    video.edit.zooms.length > 0 ||
    video.edit.trim.start > 0.05 ||
    video.edit.trim.end < video.durationSec - 0.05;

  const openUrl = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const moreItems: MenuEntry[] = [
    { label: 'Copy link', icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => void copyText(shareUrl(video.shareId)) },
    {
      label: 'Copy link at current time',
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => void copyText(shareUrl(video.shareId, usePlayerStore.getState().sourceTime)),
      disabled: !playable,
    },
  ];
  if (playable && video.playbackUrl) {
    moreItems.push('separator', { label: 'Download original', icon: <Download className="h-3.5 w-3.5" />, onSelect: () => openUrl(video.playbackUrl as string) });
    if (video.renderStatus === 'ready' && video.renderUrl) {
      moreItems.push({ label: 'Download edited MP4', icon: <Download className="h-3.5 w-3.5" />, onSelect: () => openUrl(video.renderUrl as string) });
    }
  }
  if (canEdit) {
    if (playable) {
      moreItems.push({
        label: rendering ? 'Export in progress…' : video.renderStatus === 'ready' ? 'Re-export edited MP4' : 'Export edited MP4',
        icon: <Wand2 className="h-3.5 w-3.5" />,
        onSelect: () => render.mutate(),
        disabled: rendering || !hasEdits,
      });
    }
    moreItems.push(
      'separator',
      { label: 'Edit tags', icon: <TagIcon className="h-3.5 w-3.5" />, onSelect: () => setTagging(true) },
      { label: 'Regenerate AI', icon: <RefreshCw className="h-3.5 w-3.5" />, onSelect: () => reprocess.mutate(), disabled: !playable || video.aiStatus === 'processing' },
      'separator',
      { label: 'Delete video', icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: () => setDeleting(true), danger: true },
    );
  }

  const tabs: TabItem<PanelTab>[] = [
    { value: 'transcript', label: 'Transcript', icon: <FileText className="h-3.5 w-3.5" /> },
    { value: 'summary', label: 'Summary', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { value: 'chat', label: 'Ask AI', icon: <Wand2 className="h-3.5 w-3.5" /> },
  ];
  if (canManage) tabs.push({ value: 'analytics', label: 'Insights', icon: <BarChart3 className="h-3.5 w-3.5" /> });

  const chatUnavailable =
    video.aiStatus === 'processing' || video.aiStatus === 'pending'
      ? 'Ask AI unlocks as soon as the transcript is ready.'
      : !video.transcript || video.transcript.segments.length === 0
        ? 'This video has no speech to answer questions about.'
        : 'AI answers are not configured on this Spool server.';

  const visibilityBadge =
    video.visibility === 'public' ? (
      <Badge>
        <Globe2 className="h-3 w-3" /> Public
      </Badge>
    ) : video.visibility === 'password' ? (
      <Badge tone="warn">
        <KeyRound className="h-3 w-3" /> Password
      </Badge>
    ) : (
      <Badge tone="info">
        <Users className="h-3 w-3" /> Workspace
      </Badge>
    );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/[0.06] bg-ink-900/80 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {token ? (
            <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/library')}>
              Library
            </Button>
          ) : (
            <Link to="/">
              <Logo />
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {rendering && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <Badge tone="accent" className="hidden sm:inline-flex">
                  <Spinner className="h-3 w-3" /> Exporting MP4
                </Badge>
              </motion.span>
            )}
          </AnimatePresence>
          {canEdit && playable && (
            <Button variant="outline" size="sm" leftIcon={<Scissors className="h-3.5 w-3.5" />} onClick={() => navigate(`/edit/${video.id}`)}>
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}
          {canManage ? (
            <Button variant="primary" size="sm" leftIcon={<Share2 className="h-3.5 w-3.5" />} onClick={() => setShareOpen(true)}>
              Share
            </Button>
          ) : (
            <Button variant="secondary" size="sm" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyText(shareUrl(video.shareId))}>
              Copy link
            </Button>
          )}
          <Menu
            items={moreItems}
            trigger={(props) => (
              <Button {...props} variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          />
          {!token && (
            <Link to="/register" className="hidden md:block">
              <Button variant="subtle" size="sm">
                Try Spool free
              </Button>
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            {playable && video.playbackUrl ? (
              <VideoPlayer
                src={video.playbackUrl}
                poster={video.thumbnailUrl}
                width={video.width}
                height={video.height}
                edit={video.edit}
                storyboard={video.storyboard}
                chapters={video.summary?.chapters}
                segments={video.transcript?.segments}
                initialSourceTime={initialTime}
                onFirstPlay={tracker.begin}
                onTick={tracker.tick}
              />
            ) : (
              <ProcessingState
                status={video.status}
                stage={video.pipelineStage}
                error={video.pipelineError}
                canRetry={canEdit}
                retrying={reprocess.isPending}
                onRetry={() => reprocess.mutate()}
                aspect={video.width && video.height ? video.width / video.height : 16 / 9}
                poster={video.thumbnailUrl}
              />
            )}
          </motion.div>

          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <InlineTitle video={video} editable={canEdit} onSaved={applyDetail} />
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-white/45">
                <span className="flex items-center gap-2">
                  <Avatar name={video.owner.name} color={video.owner.avatarColor} size={22} />
                  <span className="font-medium text-white/75">{video.owner.name}</span>
                </span>
                <span className="text-white/20">•</span>
                <span>{formatRelativeTime(video.createdAt)}</span>
                {length > 0 && (
                  <>
                    <span className="text-white/20">•</span>
                    <span className="tabular">{formatTimestamp(length)}</span>
                  </>
                )}
                <span className="text-white/20">•</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> {video.viewCount} {video.viewCount === 1 ? 'view' : 'views'}
                </span>
                {canManage && visibilityBadge}
                {video.tags.map((tag) => (
                  <Link key={tag.id} to={`/library?tag=${tag.id}`}>
                    <Badge className="hover:border-white/25">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                      {tag.name}
                    </Badge>
                  </Link>
                ))}
              </div>
              <InlineDescription video={video} editable={canEdit} onSaved={applyDetail} />
            </div>
          </div>
        </div>

        <aside className="surface flex h-[640px] min-h-0 flex-col overflow-hidden lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)]">
          <Tabs items={tabs} value={tab} onChange={setTab} className="shrink-0" />
          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="absolute inset-0"
              >
                {tab === 'transcript' && <TranscriptPanel transcript={video.transcript} edit={video.edit} aiStatus={video.aiStatus} title={video.title} />}
                {tab === 'summary' && (
                  <SummaryPanel
                    summary={video.summary}
                    edit={video.edit}
                    aiStatus={video.aiStatus}
                    canRegenerate={canEdit && playable}
                    regenerating={reprocess.isPending}
                    onRegenerate={() => reprocess.mutate()}
                  />
                )}
                {tab === 'chat' && <AiChatPanel shareId={video.shareId} shareToken={shareToken} edit={video.edit} canChat={canChat} unavailableReason={chatUnavailable} />}
                {tab === 'analytics' && canManage && <AnalyticsPanel videoId={video.id} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>
      </div>

      {canManage && <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} video={video} />}
      <TagPickerDialog video={tagging ? video : null} onClose={() => setTagging(false)} />
      <DeleteDialog video={deleting ? video : null} onClose={() => setDeleting(false)} onDeleted={() => navigate('/library', { replace: true })} />
    </div>
  );
}

function InlineTitle({ video, editable, onSaved }: { video: VideoDetail; editable: boolean; onSaved: (detail: VideoDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(video.title);
  useEffect(() => {
    if (!editing) setValue(video.title);
  }, [video.title, editing]);

  const mutation = useMutation({
    mutationFn: (title: string) => api.updateVideo(video.id, { title }),
    onSuccess: (detail) => {
      onSaved(detail);
      setEditing(false);
    },
    onError: (error) => toast.error('Rename failed', errorMessage(error)),
  });

  const commit = () => {
    const next = value.trim();
    if (!next || next === video.title) {
      setEditing(false);
      setValue(video.title);
      return;
    }
    mutation.mutate(next);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') {
      setValue(video.title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={160}
        disabled={mutation.isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onFocus={(e) => e.currentTarget.select()}
        className="-mx-2 w-full rounded-lg border border-accent/40 bg-ink-850 px-2 py-0.5 text-[22px] font-semibold tracking-tight text-white shadow-[0_0_0_4px_rgba(0,250,154,0.08)] outline-none"
      />
    );
  }

  return (
    <h1
      className={cn(
        'group -mx-2 flex items-center gap-2 rounded-lg px-2 py-0.5 text-[22px] font-semibold tracking-tight text-white',
        editable && 'cursor-text transition-colors hover:bg-white/[0.03]',
      )}
      onClick={() => editable && setEditing(true)}
      title={editable ? 'Click to rename' : undefined}
    >
      <span className="min-w-0 break-words">{video.title}</span>
      {editable && <Pencil className="h-3.5 w-3.5 shrink-0 text-white/0 transition-colors group-hover:text-white/40" />}
    </h1>
  );
}

function InlineDescription({ video, editable, onSaved }: { video: VideoDetail; editable: boolean; onSaved: (detail: VideoDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(video.description);
  useEffect(() => {
    if (!editing) setValue(video.description);
  }, [video.description, editing]);

  const mutation = useMutation({
    mutationFn: (description: string) => api.updateVideo(video.id, { description }),
    onSuccess: (detail) => {
      onSaved(detail);
      setEditing(false);
    },
    onError: (error) => toast.error('Could not save description', errorMessage(error)),
  });

  if (editing) {
    return (
      <div className="mt-4 space-y-2">
        <Textarea autoFocus rows={4} maxLength={5000} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add context for viewers…" />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(video.description);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate(value.trim())}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  if (!video.description) {
    return editable ? (
      <button onClick={() => setEditing(true)} className="mt-3 text-[13px] text-white/35 transition-colors hover:text-white/70">
        + Add a description
      </button>
    ) : null;
  }

  return (
    <p
      onClick={() => editable && setEditing(true)}
      className={cn('mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-white/60', editable && '-mx-2 cursor-text rounded-lg px-2 py-1 hover:bg-white/[0.03]')}
    >
      {video.description}
    </p>
  );
}
