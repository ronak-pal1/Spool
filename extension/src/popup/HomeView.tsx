import { formatDurationLabel, formatRelativeTime, type VideoListItem } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { AppWindow, Building2, Check, ChevronDown, ExternalLink, Film, LogOut, Mic, Monitor, ShieldCheck, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApi, errorMessage } from '@/lib/api';
import { request } from '@/lib/messages';
import { clearSession, writePrefs, writeSettings, type ExtensionSettings, type RecordingPrefs } from '@/lib/settings';
import type { CaptureMode } from '@/lib/state';
import { cn } from '@/ui/cn';
import { Avatar, Button, Logo, Segmented, Select, Switch, spring } from '@/ui/primitives';
import { useMediaAccess, useMicLevel } from './useMedia';

const MODE_HINTS: Record<CaptureMode, string> = {
  screen: 'Any screen, window or tab. Choose it in the next step.',
  tab: 'This tab with its audio. Clicks power automatic zooms.',
  camera: 'Just you, full frame — great for quick updates.',
};

function openUrl(url: string): void {
  void chrome.tabs.create({ url, active: true });
  window.close();
}

function openPermissions(): void {
  openUrl(chrome.runtime.getURL('permissions.html'));
}

export function HomeView({ settings }: { settings: ExtensionSettings }) {
  const { prefs } = settings;
  const media = useMediaAccess();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const api = useMemo(() => createApi(() => settingsRef.current), []);

  const updatePrefs = useCallback((patch: Partial<RecordingPrefs>) => {
    setError(null);
    void writePrefs(patch);
  }, []);

  const needsCamera = prefs.mode === 'camera' || prefs.cameraBubble;
  const needsMic = prefs.micEnabled;
  const missing = [needsMic && media.microphone !== 'granted' ? 'microphone' : null, needsCamera && media.camera !== 'granted' ? 'camera' : null].filter(
    (value): value is string => value !== null,
  );
  const blocked = media.loaded && missing.length > 0;
  const micLevel = useMicLevel(prefs.micId, needsMic && media.microphone === 'granted');

  useEffect(() => {
    void api.me().then(
      (me) => {
        const stillActive = me.workspaces.some((w) => w.id === settingsRef.current.activeWorkspaceId);
        void writeSettings({ user: me.user, workspaces: me.workspaces, activeWorkspaceId: stillActive ? settingsRef.current.activeWorkspaceId : (me.workspaces[0]?.id ?? null) });
      },
      () => undefined,
    );
    if (!settingsRef.current.webUrl) {
      void api.health().then((status) => writeSettings({ webUrl: status.webUrl }), () => undefined);
    }
  }, [api]);

  const start = async () => {
    if (blocked) {
      openPermissions();
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await request({
        type: 'spool:start',
        tabId: tab?.id ?? null,
        options: {
          mode: prefs.mode,
          micEnabled: prefs.micEnabled,
          micId: prefs.micId,
          cameraBubble: prefs.mode !== 'camera' && prefs.cameraBubble,
          cameraId: prefs.cameraId,
        },
      });
      window.close();
    } catch (err) {
      setError(errorMessage(err));
      setStarting(false);
    }
  };

  const cameraOptions = media.cameras.map((device) => ({ value: device.deviceId, label: device.label }));
  const micOptions = media.microphones.map((device) => ({ value: device.deviceId, label: device.label }));

  return (
    <div className="pb-4">
      <Header settings={settings} />

      <div className="px-4">
        <Segmented<CaptureMode>
          size="lg"
          value={prefs.mode}
          onChange={(mode) => updatePrefs({ mode })}
          options={[
            { value: 'screen', label: 'Screen', icon: <Monitor className="h-[18px] w-[18px]" /> },
            { value: 'tab', label: 'Current tab', icon: <AppWindow className="h-[18px] w-[18px]" /> },
            { value: 'camera', label: 'Camera', icon: <Video className="h-[18px] w-[18px]" /> },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={prefs.mode} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.15 }} className="mt-2 px-1 text-[12px] text-white/45">
            {MODE_HINTS[prefs.mode]}
          </motion.p>
        </AnimatePresence>

        <div className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-ink-850/80">
          <OptionRow
            icon={<Video className="h-4 w-4" />}
            title={prefs.mode === 'camera' ? 'Camera' : 'Camera bubble'}
            subtitle={prefs.mode === 'camera' ? 'Records full frame' : 'Draggable, S / M / L'}
            toggle={prefs.mode === 'camera' ? null : { checked: prefs.cameraBubble, onChange: (cameraBubble) => updatePrefs({ cameraBubble }) }}
          >
            {needsCamera && (
              <Select
                label="Camera"
                value={prefs.cameraId ?? cameraOptions[0]?.value ?? null}
                options={cameraOptions}
                onChange={(cameraId) => updatePrefs({ cameraId })}
                placeholder={media.camera === 'granted' ? 'Default camera' : 'Allow access to list cameras'}
                disabled={media.camera !== 'granted'}
              />
            )}
          </OptionRow>
          <OptionRow
            icon={<Mic className="h-4 w-4" />}
            title="Microphone"
            subtitle={prefs.micEnabled ? 'Mute anytime while recording' : 'Recording without your voice'}
            toggle={{ checked: prefs.micEnabled, onChange: (micEnabled) => updatePrefs({ micEnabled }) }}
          >
            {needsMic && (
              <div className="flex items-center gap-2">
                <Select
                  label="Microphone"
                  value={prefs.micId ?? micOptions[0]?.value ?? null}
                  options={micOptions}
                  onChange={(micId) => updatePrefs({ micId })}
                  placeholder={media.microphone === 'granted' ? 'Default microphone' : 'Allow access to list microphones'}
                  disabled={media.microphone !== 'granted'}
                />
                <LevelMeter level={micLevel} active={media.microphone === 'granted'} />
              </div>
            )}
          </OptionRow>
        </div>

        <AnimatePresence initial={false}>
          {blocked && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-warn/20 bg-warn-soft px-3 py-2.5">
                <ShieldCheck className="h-4 w-4 shrink-0 text-warn" />
                <p className="min-w-0 flex-1 text-[12px] leading-snug text-white/75">
                  Spool needs {missing.join(' and ')} access. {media.microphone === 'denied' || media.camera === 'denied' ? 'It was blocked — allow it in the next tab.' : 'It only takes a click.'}
                </p>
                <Button size="sm" variant="secondary" onClick={openPermissions}>
                  Allow
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12.5px] leading-snug text-danger">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <Button variant="primary" size="lg" className="mt-3 w-full" onClick={start} loading={starting}>
          {!starting && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent-foreground/60" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-accent-foreground" />
            </span>
          )}
          {blocked ? 'Allow access to record' : 'Start recording'}
          <kbd className="ml-1 rounded-md border border-accent-foreground/15 bg-accent-foreground/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-foreground/70">Alt⇧R</kbd>
        </Button>
      </div>

      <RecentVideos settings={settings} />
    </div>
  );
}

function OptionRow({
  icon,
  title,
  subtitle,
  toggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  toggle: { checked: boolean; onChange: (value: boolean) => void } | null;
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-ink-800 text-white/60">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-white">{title}</div>
          <div className="truncate text-[11.5px] text-white/40">{subtitle}</div>
        </div>
        {toggle && <Switch label={title} checked={toggle.checked} onChange={toggle.onChange} />}
      </div>
      <AnimatePresence initial={false}>
        {children && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="pt-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 7;
  return (
    <div className="flex h-9 shrink-0 items-center gap-[3px] rounded-lg border border-white/[0.07] bg-ink-950/50 px-2" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        const threshold = (index + 1) / (bars + 1);
        const lit = active && level >= threshold;
        return (
          <span
            key={index}
            className={cn('w-[3px] rounded-full transition-[background-color,height] duration-75', lit ? (index >= bars - 1 ? 'bg-warn' : 'bg-accent') : 'bg-white/10')}
            style={{ height: 6 + index * 2 }}
          />
        );
      })}
    </div>
  );
}

function Header({ settings }: { settings: ExtensionSettings }) {
  const [menu, setMenu] = useState<'workspace' | 'account' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const workspace = settings.workspaces.find((w) => w.id === settings.activeWorkspaceId) ?? settings.workspaces[0] ?? null;

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-2 px-4 pb-3 pt-4">
      <Logo withWordmark={false} />
      <button
        type="button"
        onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-white">{workspace?.name ?? 'Workspace'}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-white/40 transition-transform', menu === 'workspace' && 'rotate-180')} />
      </button>
      <div className="flex-1" />
      {settings.webUrl && (
        <button
          type="button"
          title="Open your library"
          onClick={() => openUrl(`${settings.webUrl}/library`)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <Film className="h-4 w-4" />
        </button>
      )}
      {settings.user && (
        <button type="button" aria-label="Account" onClick={() => setMenu(menu === 'account' ? null : 'account')} className="rounded-full ring-2 ring-transparent transition hover:ring-white/15">
          <Avatar name={settings.user.name} color={settings.user.avatarColor} />
        </button>
      )}

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={spring}
            className={cn(
              'absolute top-[52px] z-50 w-60 rounded-xl border border-white/10 bg-ink-800/95 p-1 shadow-pop backdrop-blur-xl',
              menu === 'workspace' ? 'left-3 origin-top-left' : 'right-3 origin-top-right',
            )}
          >
            {menu === 'workspace' ? (
              <>
                <div className="px-2.5 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-[0.12em] text-white/35">Record into</div>
                {settings.workspaces.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      void writeSettings({ activeWorkspaceId: w.id });
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-white/40" />
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    {w.id === workspace?.id && <Check className="h-3.5 w-3.5 text-accent" />}
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="px-2.5 pb-2 pt-1.5">
                  <div className="truncate text-[13px] font-medium text-white">{settings.user?.name}</div>
                  <div className="truncate text-[11.5px] text-white/40">{settings.user?.email}</div>
                </div>
                {settings.webUrl && (
                  <button
                    type="button"
                    onClick={() => openUrl(`${settings.webUrl}/settings`)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-white/40" />
                    Account settings
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void clearSession()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/80 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RecentVideos({ settings }: { settings: ExtensionSettings }) {
  const [videos, setVideos] = useState<VideoListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let alive = true;
    setVideos(null);
    setFailed(false);
    const api = createApi(() => settingsRef.current);
    api.listVideos({ sort: 'newest' }).then(
      (list) => alive && setVideos(list.slice(0, 3)),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [settings.activeWorkspaceId, settings.token]);

  return (
    <div className="mt-4 border-t border-white/[0.06] px-4 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">Recent</span>
        {settings.webUrl && (
          <button type="button" onClick={() => openUrl(`${settings.webUrl}/library`)} className="text-[11.5px] font-medium text-white/45 transition-colors hover:text-accent">
            View all
          </button>
        )}
      </div>
      {failed && <p className="py-3 text-center text-[12px] text-white/35">Couldn’t load your videos.</p>}
      {!failed && videos === null && (
        <div className="space-y-1">
          {[0, 1].map((key) => (
            <div key={key} className="flex items-center gap-3 rounded-xl p-1.5">
              <div className="h-9 w-16 animate-pulse rounded-md bg-white/[0.05]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-2 w-1/3 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      )}
      {videos?.length === 0 && <p className="py-3 text-center text-[12px] text-white/35">Your recordings will show up here.</p>}
      {videos && videos.length > 0 && (
        <ul className="-mx-1.5">
          {videos.map((video, index) => (
            <motion.li key={video.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
              <button
                type="button"
                disabled={!settings.webUrl}
                onClick={() => settings.webUrl && openUrl(`${settings.webUrl}/s/${video.shareId}`)}
                className="group flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-ink-800">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <Film className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-white/20" />
                  )}
                  {video.status === 'ready' && video.durationSec > 0 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold text-white tabular">{formatDurationLabel(video.editedDurationSec || video.durationSec)}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-white/85 group-hover:text-white">{video.title}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-white/35">
                    {video.status === 'processing' || video.status === 'uploading' ? (
                      <span className="inline-flex items-center gap-1 text-accent/80">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        Processing
                      </span>
                    ) : video.status === 'failed' ? (
                      <span className="text-danger/80">Failed</span>
                    ) : (
                      <span>
                        {video.viewCount} {video.viewCount === 1 ? 'view' : 'views'}
                      </span>
                    )}
                    <span>·</span>
                    <span>{formatRelativeTime(video.createdAt)}</span>
                  </span>
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
