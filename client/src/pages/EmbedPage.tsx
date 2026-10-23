import { editedDuration } from '@spool/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Logo, Spinner } from '@/components/ui/misc';
import { api, errorMessage, queryKeys } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { useViewTracking } from '@/lib/useViewTracking';
import { getShareToken, shareUrl } from '@/lib/viewer';
import type { VideoDetail } from '@spool/shared';

export function EmbedPage() {
  const { shareId = '' } = useParams();
  const share = useQuery({
    queryKey: queryKeys.share(shareId),
    queryFn: () => api.getShare(shareId, getShareToken(shareId)),
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && !data.locked && data.video.status !== 'ready' && data.video.status !== 'failed' ? 4000 : false;
    },
  });
  useDocumentTitle(share.data && !share.data.locked ? share.data.video.title : null);

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      {share.isLoading ? (
        <Spinner className="h-7 w-7" />
      ) : share.isError || !share.data ? (
        <Message title="Video unavailable" body={errorMessage(share.error)} href={null} />
      ) : share.data.locked ? (
        <Message title={share.data.title ?? 'Protected video'} body="Open this video in Spool to unlock it." href={shareUrl(shareId)} locked />
      ) : share.data.video.status !== 'ready' || !share.data.video.playbackUrl ? (
        <Message
          title={share.data.video.status === 'failed' ? 'This video could not be processed' : 'Processing…'}
          body={share.data.video.status === 'failed' ? 'Ask the creator to upload it again.' : 'This video will start playing as soon as it is ready.'}
          href={null}
          spinning={share.data.video.status !== 'failed'}
        />
      ) : (
        <EmbedPlayer video={share.data.video} />
      )}
    </div>
  );
}

function EmbedPlayer({ video }: { video: VideoDetail }) {
  const [searchParams] = useSearchParams();
  const initial = Number(searchParams.get('t'));
  const length = useMemo(() => editedDuration(video.edit), [video.edit]);
  const tracker = useViewTracking(video.shareId, getShareToken(video.shareId), video.edit, length);
  return (
    <div className="group relative h-full w-full">
      <div className="flex h-full w-full items-center [&>div]:w-full [&>div]:rounded-none [&>div]:border-0">
        <VideoPlayer
          src={video.playbackUrl as string}
          poster={video.thumbnailUrl}
          width={video.width}
          height={video.height}
          edit={video.edit}
          storyboard={video.storyboard}
          chapters={video.summary?.chapters}
          segments={video.transcript?.segments}
          initialSourceTime={Number.isFinite(initial) && initial > 0 ? initial : undefined}
          onFirstPlay={tracker.begin}
          onTick={tracker.tick}
          maxHeight="100vh"
        />
      </div>
      <a
        href={shareUrl(video.shareId)}
        target="_blank"
        rel="noreferrer"
        className="absolute left-3 top-3 z-20 flex max-w-[70%] items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs font-medium text-white/85 opacity-0 backdrop-blur-md transition-opacity duration-200 hover:text-white group-hover:opacity-100"
      >
        <span className="truncate">{video.title}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

function Message({ title, body, href, locked, spinning }: { title: string; body: string; href: string | null; locked?: boolean; spinning?: boolean }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
      {spinning ? <Spinner className="h-7 w-7" /> : locked ? <Lock className="h-6 w-6 text-accent" /> : <Logo withWordmark={false} />}
      <p className="text-[15px] font-semibold text-white">{title}</p>
      <p className="text-sm text-white/50">{body}</p>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
          Open in Spool <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
