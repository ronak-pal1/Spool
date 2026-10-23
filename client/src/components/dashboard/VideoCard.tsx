import { formatRelativeTime, formatTimestamp, type PipelineStage, type VideoListItem } from '@spool/shared';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Copy,
  Eye,
  Globe2,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Scissors,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Users,
} from 'lucide-react';
import { memo, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/hooks';
import { shareUrl } from '@/lib/viewer';
import { Menu } from '../ui/Menu';
import { Avatar } from '../ui/misc';

const STAGE_LABEL: Record<PipelineStage, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  transcoding: 'Optimizing video',
  transcribing: 'Transcribing',
  summarizing: 'Writing summary',
  indexing: 'Indexing for search',
  complete: 'Ready',
  failed: 'Failed',
};

const STAGE_PROGRESS: Record<PipelineStage, number> = {
  uploading: 0.1,
  queued: 0.18,
  transcoding: 0.4,
  transcribing: 0.62,
  summarizing: 0.8,
  indexing: 0.92,
  complete: 1,
  failed: 1,
};

export interface VideoCardActions {
  onRename: (video: VideoListItem) => void;
  onTags: (video: VideoListItem) => void;
  onDelete: (video: VideoListItem) => void;
}

const visibilityIcon = {
  public: <Globe2 className="h-3 w-3" />,
  password: <Lock className="h-3 w-3" />,
  workspace: <Users className="h-3 w-3" />,
};

export const VideoCard = memo(function VideoCard({ video, actions, index }: { video: VideoListItem; actions: VideoCardActions; index: number }) {
  const navigate = useNavigate();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const processing = video.status === 'uploading' || video.status === 'processing';
  const failed = video.status === 'failed';
  const aiWorking = video.status === 'ready' && (video.aiStatus === 'processing' || video.aiStatus === 'pending') && video.pipelineStage !== 'complete';
  const storyboard = video.storyboard;
  const href = `/s/${video.shareId}`;

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!storyboard || event.pointerType === 'touch') return;
    const rect = thumbRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverRatio(Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  const frameIndex = storyboard && hoverRatio !== null ? Math.min(storyboard.frames - 1, Math.floor(hoverRatio * storyboard.frames)) : null;
  const duration = video.editedDurationSec || video.durationSec;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, delay: Math.min(index, 12) * 0.025 }}
      className="group relative"
    >
      <Link
        to={href}
        className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
      >
        <motion.div
          ref={thumbRef}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverRatio(null)}
          whileHover={{ y: -3 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          className="relative aspect-video overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-800 shadow-card transition-[border-color,box-shadow] duration-300 group-hover:border-white/15 group-hover:shadow-[0_24px_50px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,250,154,0.12)]"
        >
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_30%_20%,rgba(0,250,154,0.10),transparent_60%)]" />
          )}

          {storyboard && frameIndex !== null && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${storyboard.url})`,
                backgroundSize: `${storyboard.frames * 100}% 100%`,
                backgroundPosition: `${storyboard.frames > 1 ? (frameIndex / (storyboard.frames - 1)) * 100 : 0}% 0%`,
              }}
            />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-80" />

          {processing && <ProcessingOverlay stage={video.pipelineStage} />}
          {failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900/80 backdrop-blur-sm">
              <AlertTriangle className="h-5 w-5 text-danger" />
              <span className="text-xs font-medium text-white/70">Processing failed</span>
            </div>
          )}

          {!processing && !failed && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <motion.span
                initial={false}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white shadow-glow backdrop-blur-md"
              >
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </motion.span>
            </div>
          )}

          {storyboard && hoverRatio !== null && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
              <div className="h-full bg-accent shadow-[0_0_8px_rgba(0,250,154,0.9)]" style={{ width: `${hoverRatio * 100}%` }} />
            </div>
          )}

          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
            {aiWorking && (
              <span className="flex items-center gap-1 rounded-full border border-accent/30 bg-black/50 px-2 py-0.5 text-2xs font-medium text-accent backdrop-blur-md">
                <Sparkles className="h-3 w-3 animate-pulse" />
                {STAGE_LABEL[video.pipelineStage]}
              </span>
            )}
          </div>

          {duration > 0 && !processing && (
            <span className="tabular absolute bottom-2.5 right-2.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-2xs font-medium text-white/90 backdrop-blur-md">
              {formatTimestamp(frameIndex !== null && storyboard ? frameIndex * storyboard.interval : duration)}
            </span>
          )}
        </motion.div>
      </Link>

      <div className="flex items-start gap-3 px-1 pt-3">
        <Avatar name={video.owner.name} color={video.owner.avatarColor} size={26} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link to={href} className="block truncate text-sm font-medium text-white/90 transition-colors hover:text-white" title={video.title}>
            {video.title}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-xs text-white/40">
            <span className="truncate">{video.owner.name}</span>
            <span className="text-white/20">·</span>
            <span className="shrink-0">{formatRelativeTime(video.createdAt)}</span>
            <span className="text-white/20">·</span>
            <span className="flex shrink-0 items-center gap-1" title={`${video.viewCount} views`}>
              <Eye className="h-3 w-3" />
              {video.viewCount}
            </span>
            <span className="flex shrink-0 items-center text-white/35" title={`Visibility: ${video.visibility}`}>
              {visibilityIcon[video.visibility]}
            </span>
          </div>
          {video.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {video.tags.slice(0, 3).map((tag) => (
                <Link
                  key={tag.id}
                  to={`/library?tag=${tag.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-2xs text-white/60 transition-colors hover:border-white/20 hover:text-white"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                  {tag.name}
                </Link>
              ))}
              {video.tags.length > 3 && <span className="px-1 text-2xs text-white/35">+{video.tags.length - 3}</span>}
            </div>
          )}
        </div>
        <Menu
          trigger={(props) => (
            <button
              {...props}
              aria-label="Video actions"
              className={cn(
                '-mr-1 rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.06] hover:text-white',
                props['aria-expanded'] ? 'bg-white/[0.06] text-white opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
          items={[
            { label: 'Open', icon: <Play className="h-3.5 w-3.5" />, onSelect: () => navigate(href) },
            { label: 'Edit video', icon: <Scissors className="h-3.5 w-3.5" />, onSelect: () => navigate(`/edit/${video.id}`), disabled: video.status !== 'ready' },
            { label: 'Copy link', icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => void copyText(shareUrl(video.shareId)) },
            'separator',
            { label: 'Rename', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => actions.onRename(video) },
            { label: 'Tags', icon: <TagIcon className="h-3.5 w-3.5" />, onSelect: () => actions.onTags(video) },
            'separator',
            { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => actions.onDelete(video) },
          ]}
        />
      </div>
    </motion.article>
  );
});

function ProcessingOverlay({ stage }: { stage: PipelineStage }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900/75 backdrop-blur-[6px]">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent/50" />
        <span className="absolute inset-1.5 animate-spin rounded-full border-2 border-white/10 border-t-accent" />
      </div>
      <span className="text-xs font-medium text-white/75">{STAGE_LABEL[stage]}…</span>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-accent shadow-[0_0_10px_rgba(0,250,154,0.8)]"
          initial={false}
          animate={{ width: `${STAGE_PROGRESS[stage] * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      </div>
    </div>
  );
}

export function VideoCardSkeleton() {
  return (
    <div>
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.03]">
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
      </div>
      <div className="flex gap-3 px-1 pt-3">
        <div className="h-[26px] w-[26px] rounded-full bg-white/[0.05]" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-3/4 rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}
