import {
  editedDuration,
  sourceToEdited,
  splitSegments,
  toggleSegmentCut,
  type BlurRegion,
  type VideoDetail,
  type ZoomSegment,
} from '@spool/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Download,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  ScanSearch,
  Scissors,
  SquareDashed,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { EditorPreview } from '@/components/editor/EditorPreview';
import { Inspector } from '@/components/editor/Inspector';
import { Timeline } from '@/components/editor/Timeline';
import { formatPrecise } from '@/components/editor/timeline-math';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, EmptyState, Spinner, Switch } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/Tooltip';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/hooks';
import { isTypingTarget } from '@/lib/media';
import { createLocalId } from '@/lib/viewer';
import { editsEqual, useEditorDirty, useEditorStore } from '@/store/editor.store';
import { usePlayerStore } from '@/store/player.store';
import { toast } from '@/store/toast.store';

const FRAME = 1 / 30;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function EditorPage() {
  const { videoId = '' } = useParams();
  const video = useQuery({
    queryKey: queryKeys.video(videoId),
    queryFn: () => api.getVideo(videoId),
    refetchInterval: (q) => (q.state.data && (q.state.data.renderStatus === 'queued' || q.state.data.renderStatus === 'rendering') ? 3000 : false),
  });
  useDocumentTitle(video.data ? `Edit · ${video.data.title}` : 'Editor');

  if (video.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  const data = video.data;
  if (video.isError || !data || !data.permissions.canEdit || data.status !== 'ready' || !data.playbackUrl) {
    const reason = video.isError
      ? errorMessage(video.error)
      : !data
        ? 'Video not found.'
        : !data.permissions.canEdit
          ? 'Only the creator or a workspace admin can edit this video.'
          : 'This video is still processing. The editor opens once it is ready.';
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <EmptyState
          icon={<Scissors className="h-6 w-6" />}
          title="Editor unavailable"
          description={reason}
          action={
            <Link to={data ? `/s/${data.shareId}` : '/library'}>
              <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Go back
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return <Editor key={data.id} video={data} />;
}

function useThrottledTime(intervalMs = 90): number {
  const [time, setTime] = useState(usePlayerStore.getState().sourceTime);
  useEffect(() => {
    let last = 0;
    let timer = 0;
    const unsubscribe = usePlayerStore.subscribe((state) => {
      const now = performance.now();
      window.clearTimeout(timer);
      if (now - last >= intervalMs) {
        last = now;
        setTime(state.sourceTime);
      } else {
        timer = window.setTimeout(() => setTime(usePlayerStore.getState().sourceTime), intervalMs);
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [intervalMs]);
  return time;
}

function Editor({ video }: { video: VideoDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const duration = video.durationSec;
  const load = useEditorStore((s) => s.load);
  const loadedId = useEditorStore((s) => s.videoId);
  const edit = useEditorStore((s) => s.edit);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const update = useEditorStore((s) => s.update);
  const select = useEditorStore((s) => s.select);
  const markSaved = useEditorStore((s) => s.markSaved);
  const previewEdits = useEditorStore((s) => s.previewEdits);
  const setPreviewEdits = useEditorStore((s) => s.setPreviewEdits);
  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const dirty = useEditorDirty();
  const playing = usePlayerStore((s) => s.playing);
  const time = useThrottledTime();
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    load(video.id, duration, video.edit);
    usePlayerStore.setState({ sourceTime: video.edit.trim.start, playing: false });
  }, [video.id]);

  const ready = loadedId === video.id;

  const applyDetail = useCallback(
    (detail: VideoDetail) => {
      queryClient.setQueryData(queryKeys.video(detail.id), detail);
      queryClient.setQueryData(queryKeys.share(detail.shareId), { locked: false, video: detail });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVideos });
    },
    [queryClient],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const snapshot = useEditorStore.getState().edit;
      const detail = await api.saveEdit(video.id, snapshot);
      return { detail, snapshot };
    },
    onSuccess: ({ detail, snapshot }) => {
      markSaved(snapshot);
      applyDetail(detail);
    },
  });

  const save = useCallback(async (): Promise<boolean> => {
    if (saveMutation.isPending) return false;
    try {
      await saveMutation.mutateAsync();
      toast.success('Edits saved', 'Viewers see the new version right away.');
      return true;
    } catch (error) {
      toast.error('Could not save edits', errorMessage(error));
      return false;
    }
  }, [saveMutation]);

  const exportMutation = useMutation({
    mutationFn: () => api.renderVideo(video.id),
    onSuccess: (detail) => {
      applyDetail(detail);
      toast.info('Export started', 'Rendering an MP4 with every cut, zoom and blur baked in.');
    },
    onError: (error) => toast.error('Export failed to start', errorMessage(error)),
  });

  const exportVideo = async () => {
    if (!editsEqual(useEditorStore.getState().edit, useEditorStore.getState().saved)) {
      const ok = await save();
      if (!ok) return;
    }
    exportMutation.mutate();
  };

  const previousRender = useRef(video.renderStatus);
  useEffect(() => {
    if (previousRender.current === video.renderStatus) return;
    if (video.renderStatus === 'ready') toast.success('Export ready', 'Download your edited MP4 from the toolbar.');
    if (video.renderStatus === 'failed') toast.error('Export failed', video.renderError ?? undefined);
    previousRender.current = video.renderStatus;
  }, [video.renderStatus, video.renderError]);

  const seek = useCallback((t: number) => usePlayerStore.getState().controller?.seek(t, false), []);
  const now = () => usePlayerStore.getState().sourceTime;

  const splitAtPlayhead = useCallback(() => {
    const t = now();
    const state = useEditorStore.getState();
    const { trim, splits } = state.edit;
    if (t <= trim.start + 0.1 || t >= trim.end - 0.1 || splits.some((s) => Math.abs(s - t) < 0.1)) {
      toast.info('Move the playhead inside a clip to split it');
      return;
    }
    update((e) => ({ ...e, splits: [...e.splits, t] }));
    const index = splitSegments(useEditorStore.getState().edit).findIndex((s) => t >= s.start && t < s.end);
    if (index >= 0) select({ kind: 'segment', index });
  }, [update, select]);

  const cutAtPlayhead = useCallback(() => {
    const t = now();
    const segment = splitSegments(useEditorStore.getState().edit).find((s) => t >= s.start && t < s.end);
    if (!segment) return;
    update((e) => toggleSegmentCut(e, segment));
    select({ kind: 'segment', index: segment.index });
  }, [update, select]);

  const addZoom = useCallback(
    (at: number) => {
      const zooms = [...useEditorStore.getState().edit.zooms].sort((a, b) => a.start - b.start);
      const existing = zooms.find((z) => at >= z.start && at <= z.end);
      if (existing) {
        select({ kind: 'zoom', id: existing.id });
        return;
      }
      const next = zooms.find((z) => z.start > at);
      const end = Math.min(duration, at + 3, next ? next.start : duration);
      if (end - at < 0.6) {
        toast.info('Not enough room for a zoom here');
        return;
      }
      const nearby = video.clickEvents.filter((c) => Math.abs(c.t - at) < 2);
      const focus = nearby.length
        ? { x: nearby.reduce((s, c) => s + c.x, 0) / nearby.length, y: nearby.reduce((s, c) => s + c.y, 0) / nearby.length }
        : { x: 0.5, y: 0.5 };
      const zoom: ZoomSegment = { id: createLocalId(), start: at, end, focus, scale: 2, source: 'manual' };
      update((e) => ({ ...e, zooms: [...e.zooms, zoom] }));
      select({ kind: 'zoom', id: zoom.id });
      usePlayerStore.getState().controller?.pause();
    },
    [duration, update, select, video.clickEvents],
  );

  const addBlur = useCallback(
    (at: number) => {
      const blur: BlurRegion = { id: createLocalId(), start: at, end: Math.min(duration, at + 4), rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 }, intensity: 6 };
      if (blur.end - blur.start < 0.2) return;
      update((e) => ({ ...e, blurs: [...e.blurs, blur] }));
      select({ kind: 'blur', id: blur.id });
      usePlayerStore.getState().controller?.pause();
    },
    [duration, update, select],
  );

  const startDrawing = useCallback(() => {
    usePlayerStore.getState().controller?.pause();
    select(null);
    setDrawing(true);
  }, [select]);

  const deleteSelection = useCallback(() => {
    const { selection, edit: current } = useEditorStore.getState();
    if (!selection) return;
    if (selection.kind === 'blur') update((e) => ({ ...e, blurs: e.blurs.filter((b) => b.id !== selection.id) }));
    else if (selection.kind === 'zoom') update((e) => ({ ...e, zooms: e.zooms.filter((z) => z.id !== selection.id) }));
    else {
      const segment = splitSegments(current)[selection.index];
      if (segment && !segment.cut) update((e) => toggleSegmentCut(e, segment));
      return;
    }
    select(null);
  }, [update, select]);

  const togglePlay = useCallback(() => {
    const { controller, playing: isPlaying } = usePlayerStore.getState();
    if (isPlaying) controller?.pause();
    else controller?.play();
  }, []);

  const shortcuts = useRef({ save, splitAtPlayhead, cutAtPlayhead, addZoom, startDrawing, deleteSelection, togglePlay, seek });
  shortcuts.current = { save, splitAtPlayhead, cutAtPlayhead, addZoom, startDrawing, deleteSelection, togglePlay, seek };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const s = shortcuts.current;
      if (mod && key === 's') {
        event.preventDefault();
        void s.save();
        return;
      }
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        useEditorStore.getState().redo();
        return;
      }
      if (mod || event.altKey) return;
      switch (key) {
        case ' ':
        case 'k':
          event.preventDefault();
          if (event.target instanceof HTMLButtonElement) event.target.blur();
          s.togglePlay();
          break;
        case 's':
          event.preventDefault();
          s.splitAtPlayhead();
          break;
        case 'c':
          event.preventDefault();
          s.cutAtPlayhead();
          break;
        case 'z':
          event.preventDefault();
          s.addZoom(usePlayerStore.getState().sourceTime);
          break;
        case 'b':
          event.preventDefault();
          s.startDrawing();
          break;
        case 'delete':
        case 'backspace':
          event.preventDefault();
          s.deleteSelection();
          break;
        case 'escape':
          setDrawing(false);
          useEditorStore.getState().select(null);
          break;
        case 'arrowleft':
        case 'arrowright': {
          event.preventDefault();
          const delta = (event.shiftKey ? 1 : FRAME) * (key === 'arrowleft' ? -1 : 1);
          s.seek(Math.max(0, usePlayerStore.getState().sourceTime + delta));
          break;
        }
        case 'home':
          event.preventDefault();
          s.seek(useEditorStore.getState().edit.trim.start);
          break;
        case 'end':
          event.preventDefault();
          s.seek(useEditorStore.getState().edit.trim.end - 0.05);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const editedNow = sourceToEdited(edit, time);
  const total = editedDuration(edit);
  const rendering = video.renderStatus === 'queued' || video.renderStatus === 'rendering';
  const modKey = isMac ? '⌘' : 'Ctrl+';

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back to video" onClick={() => navigate(`/s/${video.shareId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{video.title}</p>
            <p className="flex items-center gap-1.5 text-2xs text-white/40">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={saveMutation.isPending ? 'saving' : dirty ? 'dirty' : 'saved'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className="flex items-center gap-1.5">
                  {saveMutation.isPending ? (
                    <>
                      <Spinner className="h-2.5 w-2.5" /> Saving…
                    </>
                  ) : dirty ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-warn" /> Unsaved changes
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3 text-accent" /> All changes saved
                    </>
                  )}
                </motion.span>
              </AnimatePresence>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Tooltip content="Undo" shortcut={`${modKey}Z`} side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={past === 0} onClick={undo}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Redo" shortcut={`⇧${modKey}Z`} side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={future === 0} onClick={redo}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <div className="mx-1.5 h-5 w-px bg-white/10" />
          {video.renderStatus === 'ready' && video.renderUrl && !rendering && (
            <Button variant="ghost" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => window.open(video.renderUrl as string, '_blank', 'noopener,noreferrer')}>
              <span className="hidden md:inline">Download MP4</span>
            </Button>
          )}
          {rendering ? (
            <Badge tone="accent" className="h-8 px-3">
              <Spinner className="h-3 w-3" /> Exporting…
            </Badge>
          ) : (
            <Button variant="outline" size="sm" leftIcon={<Wand2 className="h-3.5 w-3.5" />} loading={exportMutation.isPending} onClick={() => void exportVideo()}>
              <span className="hidden sm:inline">Export MP4</span>
            </Button>
          )}
          <Button variant="primary" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} loading={saveMutation.isPending} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 p-4 sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgba(0,250,154,0.05),transparent)]" />
            <EditorPreview
              src={video.playbackUrl as string}
              poster={video.thumbnailUrl}
              width={video.width}
              height={video.height}
              duration={duration}
              drawing={drawing}
              onDrawingDone={() => setDrawing(false)}
            />
          </div>

          <div className="flex h-12 shrink-0 items-center gap-2 border-t border-white/[0.06] px-3">
            <Button variant="secondary" size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
            </Button>
            <div className="tabular min-w-[132px] font-mono text-xs">
              <span className="text-white">{formatPrecise(editedNow)}</span>
              <span className="text-white/30"> / {formatPrecise(total)}</span>
            </div>
            <div className="mx-1 h-5 w-px bg-white/10" />
            <ToolButton label="Split" shortcut="S" icon={<Scissors className="h-3.5 w-3.5" />} onClick={splitAtPlayhead} />
            <ToolButton label="Zoom" shortcut="Z" icon={<ScanSearch className="h-3.5 w-3.5" />} onClick={() => addZoom(now())} />
            <ToolButton label="Blur" shortcut="B" icon={<SquareDashed className="h-3.5 w-3.5" />} onClick={drawing ? () => setDrawing(false) : startDrawing} active={drawing} />
            <div className="ml-auto flex items-center gap-4">
              <label className="hidden items-center gap-2 text-xs text-white/55 md:flex">
                Preview cuts
                <Switch checked={previewEdits} onChange={setPreviewEdits} label="Preview cuts" />
              </label>
              <div className="flex items-center gap-1.5">
                <button className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white" aria-label="Zoom out timeline" onClick={() => setTimelineZoom(timelineZoom / 1.5)}>
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Math.log(timelineZoom) / Math.log(20)}
                  onChange={(e) => setTimelineZoom(Math.pow(20, Number(e.target.value)))}
                  className="w-24"
                  aria-label="Timeline zoom"
                />
                <button className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white" aria-label="Zoom in timeline" onClick={() => setTimelineZoom(timelineZoom * 1.5)}>
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <Timeline duration={duration} storyboard={video.storyboard} clickEvents={video.clickEvents} onSeek={seek} onAddZoom={addZoom} onAddBlur={addBlur} />
        </div>

        <aside className="hidden w-[300px] shrink-0 border-l border-white/[0.06] bg-ink-900/60 lg:block">
          <Inspector duration={duration} clickEvents={video.clickEvents} />
        </aside>
      </div>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        description="Your latest edits haven't been saved yet."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              onClick={() => {
                void save().then((ok) => {
                  if (ok) blocker.proceed?.();
                });
              }}
            >
              Save & leave
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/55">Saved edits apply instantly for viewers — no re-upload or re-render needed.</p>
      </Dialog>
    </div>
  );
}

function ToolButton({ label, shortcut, icon, onClick, active }: { label: string; shortcut: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        onClick={onClick}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
          active ? 'border-violet-300/50 bg-violet-400/15 text-violet-100' : 'border-white/[0.08] text-white/70 hover:border-white/15 hover:bg-white/[0.04] hover:text-white',
        )}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
    </Tooltip>
  );
}
