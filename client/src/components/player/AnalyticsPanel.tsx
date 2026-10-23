import { formatDurationLabel, formatRelativeTime } from '@spool/shared';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BarChart3, Clock, Eye, Target, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, queryKeys } from '@/lib/api';
import { Avatar, EmptyState, Skeleton } from '../ui/misc';

function Stat({ icon, label, value, delay }: { icon: React.ReactNode; label: string; value: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay } }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
    >
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.12em] text-white/40">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular tracking-tight text-white">{value}</div>
    </motion.div>
  );
}

function RetentionChart({ retention }: { retention: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 320;
  const height = 110;
  const points = retention.map((value, i) => ({
    x: retention.length > 1 ? (i / (retention.length - 1)) * width : 0,
    y: height - value * (height - 8) - 4,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full overflow-visible"
        preserveAspectRatio="none"
        onPointerMove={(event) => {
          const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
          const index = Math.round(((event.clientX - rect.left) / rect.width) * (retention.length - 1));
          setHover(Math.max(0, Math.min(retention.length - 1, index)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="retention-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#00FA9A" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00FA9A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 4" />
        ))}
        <motion.path d={area} fill="url(#retention-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path
          d={path}
          fill="none"
          stroke="#00FA9A"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ filter: 'drop-shadow(0 0 6px rgba(0,250,154,0.6))' }}
        />
        {hover !== null && points[hover] && (
          <line x1={points[hover].x} x2={points[hover].x} y1="0" y2={height} stroke="rgba(255,255,255,0.25)" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-2 right-0 rounded-md bg-ink-700 px-2 py-1 font-mono text-2xs text-white">
          {Math.round((hover / Math.max(retention.length - 1, 1)) * 100)}% in · {Math.round((retention[hover] ?? 0) * 100)}% watching
        </div>
      )}
    </div>
  );
}

export function AnalyticsPanel({ videoId }: { videoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.analytics(videoId),
    queryFn: () => api.getAnalytics(videoId),
    refetchInterval: 30_000,
  });
  const maxDay = useMemo(() => Math.max(1, ...(data?.viewsByDay.map((d) => d.views) ?? [1])), [data]);

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-2 p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
        <Skeleton className="col-span-2 h-36 rounded-xl" />
      </div>
    );
  }

  if (data.totalViews === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title="No views yet"
        description="Share the link — views, watch time and drop-off will appear here in real time. Your own views are never counted."
      />
    );
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat icon={<Eye className="h-3 w-3" />} label="Views" value={data.totalViews.toLocaleString()} delay={0} />
        <Stat icon={<Users className="h-3 w-3" />} label="Viewers" value={data.uniqueViewers.toLocaleString()} delay={0.04} />
        <Stat icon={<Clock className="h-3 w-3" />} label="Avg. watch" value={formatDurationLabel(data.averageWatchSeconds)} delay={0.08} />
        <Stat icon={<Target className="h-3 w-3" />} label="Completion" value={`${Math.round(data.completionRate * 100)}%`} delay={0.12} />
      </div>

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="label">Audience retention</h3>
          <span className="text-2xs text-white/40">avg. {Math.round(data.averageCompletion * 100)}% watched</span>
        </div>
        <RetentionChart retention={data.retention} />
      </section>

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="label mb-3">Views · last 14 days</h3>
        <div className="flex h-24 items-end gap-1">
          {data.viewsByDay.map((day, i) => (
            <div key={day.date} className="group relative flex h-full flex-1 items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(day.views > 0 ? 8 : 3, (day.views / maxDay) * 100)}%` }}
                transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i * 0.02 }}
                className={day.views > 0 ? 'w-full rounded-t-[4px] bg-accent/70 group-hover:bg-accent' : 'w-full rounded-t-[4px] bg-white/[0.06]'}
              />
              <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-700 px-1.5 py-0.5 text-2xs text-white group-hover:block">
                {day.views} · {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="label mb-2">Recent viewers</h3>
        <ul className="divide-y divide-white/[0.05]">
          {data.recentViewers.map((viewer, i) => (
            <li key={`${viewer.viewedAt}-${i}`} className="flex items-center gap-3 py-2.5">
              {viewer.avatarColor ? (
                <Avatar name={viewer.name} color={viewer.avatarColor} size={26} />
              ) : (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/[0.07] text-white/40">
                  <Eye className="h-3 w-3" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-white/80">{viewer.name}</p>
                <p className="text-2xs text-white/35">{formatRelativeTime(viewer.viewedAt)}</p>
              </div>
              <div className="w-20">
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${viewer.watchedPercent}%` }} />
                </div>
                <p className="mt-1 text-right font-mono text-2xs text-white/40">{viewer.watchedPercent}%</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
