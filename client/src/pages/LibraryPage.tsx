import { formatDurationLabel, type ListVideosQuery, type VideoListItem, type VideoStatus } from '@spool/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownUp, Film, Search, UploadCloud, Video, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { VideoCard, VideoCardSkeleton, type VideoCardActions } from '@/components/dashboard/VideoCard';
import { DeleteDialog, RenameDialog, TagPickerDialog } from '@/components/dashboard/VideoDialogs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Menu } from '@/components/ui/Menu';
import { EmptyState } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/Tabs';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { useActiveWorkspace } from '@/store/auth.store';
import { ACCEPTED_VIDEO, useUploadsStore } from '@/store/uploads.store';

type StatusFilter = VideoStatus | 'all';
type Sort = NonNullable<ListVideosQuery['sort']>;

const SORT_LABEL: Record<Sort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  title: 'Title A–Z',
  views: 'Most viewed',
  duration: 'Longest',
};

export function LibraryPage() {
  const navigate = useNavigate();
  const workspace = useActiveWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const tagId = searchParams.get('tag') ?? undefined;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const debounced = useDebounced(query.trim(), 250);
  const uploadFile = useUploadsStore((s) => s.uploadFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<VideoListItem | null>(null);
  const [tagging, setTagging] = useState<VideoListItem | null>(null);
  const [deleting, setDeleting] = useState<VideoListItem | null>(null);
  useDocumentTitle('Library');

  const filters: ListVideosQuery = { q: debounced || undefined, tag: tagId, status, sort };
  const videos = useQuery({
    queryKey: queryKeys.videos(workspace?.id ?? null, filters),
    queryFn: () => api.listVideos(filters),
    enabled: Boolean(workspace),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => (q.state.data?.some((v) => v.status === 'uploading' || v.status === 'processing' || (v.status === 'ready' && v.aiStatus === 'processing')) ? 4000 : false),
  });

  const tags = useQuery({ queryKey: queryKeys.tags(workspace?.id ?? null), queryFn: () => api.listTags(), enabled: Boolean(workspace) });
  const activeTag = tags.data?.find((t) => t.id === tagId) ?? null;

  const actions = useMemo<VideoCardActions>(() => ({ onRename: setRenaming, onTags: setTagging, onDelete: setDeleting }), []);

  const list = videos.data ?? [];
  const filtered = Boolean(debounced || tagId || status !== 'all');
  const totalDuration = list.reduce((sum, v) => sum + (v.editedDurationSec || v.durationSec), 0);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 pb-20 pt-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">{workspace?.name ?? 'Workspace'}</p>
          <h1 className="mt-1.5 flex items-center gap-3 text-[26px] font-semibold tracking-tight text-white">
            {activeTag ? (
              <>
                <span className="h-3 w-3 rounded-full" style={{ background: activeTag.color, boxShadow: `0 0 14px ${activeTag.color}` }} />
                {activeTag.name}
              </>
            ) : (
              'Library'
            )}
          </h1>
          <p className="mt-1 text-sm text-white/40">
            {videos.isSuccess ? `${list.length} ${list.length === 1 ? 'video' : 'videos'} · ${formatDurationLabel(totalDuration)} of content` : ' '}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" leftIcon={<UploadCloud className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          <Button variant="primary" leftIcon={<Video className="h-4 w-4" />} onClick={() => navigate('/record')}>
            Record
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
      </div>

      <div className="sticky top-0 z-20 -mx-5 mt-6 border-b border-white/[0.05] bg-ink-900/80 px-5 py-3 backdrop-blur-md sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-full sm:w-72"
            icon={<Search className="h-4 w-4" />}
            placeholder="Filter by title, transcript…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            trailing={
              query ? (
                <button onClick={() => setQuery('')} className="rounded p-1 text-white/40 hover:text-white" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null
            }
          />
          <Segmented
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ready', label: 'Ready' },
              { value: 'processing', label: 'Processing' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
          <AnimatePresence>
            {activeTag && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => setSearchParams({})}
                className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] pl-2.5 pr-2 text-xs text-white/75 hover:border-white/20"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: activeTag.color }} />
                {activeTag.name}
                <X className="h-3 w-3 text-white/40" />
              </motion.button>
            )}
          </AnimatePresence>
          <div className="ml-auto">
            <Menu
              items={(Object.keys(SORT_LABEL) as Sort[]).map((value) => ({ label: SORT_LABEL[value], checked: value === sort, onSelect: () => setSort(value) }))}
              trigger={(props) => (
                <Button {...props} variant="ghost" size="sm" leftIcon={<ArrowDownUp className="h-3.5 w-3.5" />}>
                  {SORT_LABEL[sort]}
                </Button>
              )}
            />
          </div>
        </div>
      </div>

      <div className="mt-6">
        {videos.isLoading || !workspace ? (
          <Grid>
            {Array.from({ length: 8 }, (_, i) => (
              <VideoCardSkeleton key={i} />
            ))}
          </Grid>
        ) : videos.isError ? (
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title="Couldn't load your library"
            description={errorMessage(videos.error)}
            action={
              <Button variant="secondary" onClick={() => void videos.refetch()}>
                Try again
              </Button>
            }
          />
        ) : list.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Search className="h-6 w-6" />} title="No matching videos" description="Try a different search term, status or tag." />
          ) : (
            <EmptyState
              icon={<Video className="h-6 w-6" />}
              title="Record your first Spool"
              description="Capture your screen and camera from the browser, the Chrome extension or the desktop app — or drop a video file anywhere on this page."
              action={
                <div className="flex gap-2">
                  <Button variant="primary" leftIcon={<Video className="h-4 w-4" />} onClick={() => navigate('/record')}>
                    Start recording
                  </Button>
                  <Button variant="outline" leftIcon={<UploadCloud className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    Upload a file
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <Grid>
            <AnimatePresence>
              {list.map((video, index) => (
                <VideoCard key={video.id} video={video} actions={actions} index={index} />
              ))}
            </AnimatePresence>
          </Grid>
        )}
      </div>

      <RenameDialog video={renaming} onClose={() => setRenaming(null)} />
      <TagPickerDialog video={tagging} onClose={() => setTagging(null)} />
      <DeleteDialog video={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{children}</div>;
}
