import {
  editedDuration,
  editedToSource,
  formatTimestamp,
  keptRanges,
  snapToKept,
  sourceToEdited,
  type Chapter,
  type EditConfig,
  type StoryboardMeta,
  type TranscriptSegment,
} from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Captions,
  Gauge,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { isTypingTarget, useFitBox, useStableUrl } from '@/lib/media';
import { usePlayerStore } from '@/store/player.store';
import { Menu } from '../ui/Menu';
import { BlurOverlays } from './BlurOverlays';
import { Scrubber } from './Scrubber';
import { usePlaybackEngine } from './usePlaybackEngine';

export interface VideoPlayerProps {
  src: string;
  poster?: string | null;
  width: number;
  height: number;
  edit: EditConfig;
  storyboard: StoryboardMeta | null;
  chapters?: Chapter[];
  segments?: TranscriptSegment[];
  initialSourceTime?: number;
  onFirstPlay?: () => void;
  onTick?: (sourceTime: number, playing: boolean) => void;
  maxHeight?: string;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function VideoPlayer({
  src,
  poster,
  width,
  height,
  edit,
  storyboard,
  chapters = [],
  segments = [],
  initialSourceTime,
  onFirstPlay,
  onTick,
  maxHeight = '72vh',
}: VideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stableSrc = useStableUrl(src);
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const box = useFitBox(frameRef, ratio);

  const [playing, setPlaying] = useState(false);
  const [sourceTime, setSourceTime] = useState(0);
  const [bufferedSource, setBufferedSource] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('spool-volume') ?? '1'));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('spool-speed') ?? '1'));
  const [captions, setCaptions] = useState(() => localStorage.getItem('spool-captions') === '1');
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [flash, setFlash] = useState<{ id: number; kind: 'play' | 'pause' | 'back' | 'forward' } | null>(null);
  const hideTimer = useRef<number>();
  const startedRef = useRef(false);
  const wasPlayingBeforeScrub = useRef(false);
  const setStoreTime = usePlayerStore((s) => s.setTime);
  const setStorePlaying = usePlayerStore((s) => s.setPlaying);
  const registerController = usePlayerStore((s) => s.register);
  const lastStoreUpdate = useRef(0);

  const totalEdited = useMemo(() => editedDuration(edit), [edit]);
  const editedTime = sourceToEdited(edit, sourceTime);
  const editedChapters = useMemo(
    () =>
      chapters
        .map((c) => ({ title: c.title, start: sourceToEdited(edit, c.start) }))
        .filter((c, i, all) => i === 0 || c.start - (all[i - 1]?.start ?? 0) > 1),
    [chapters, edit],
  );

  const onEngineTick = useCallback(
    (time: number) => {
      setSourceTime(time);
      const now = performance.now();
      if (now - lastStoreUpdate.current > 120) {
        lastStoreUpdate.current = now;
        setStoreTime(time);
        const video = videoRef.current;
        onTick?.(time, Boolean(video && !video.paused));
      }
    },
    [onTick, setStoreTime],
  );

  const { blurs } = usePlaybackEngine({
    videoRef,
    stageRef,
    edit,
    applyCuts: true,
    onTick: onEngineTick,
  });

  const seekSource = useCallback((time: number, play?: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, time);
    if (play) void video.play().catch(() => undefined);
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const snap = snapToKept(edit, video.currentTime);
    if (snap.ended) video.currentTime = keptRanges(edit)[0]?.start ?? 0;
    void video.play().catch(() => undefined);
  }, [edit]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      play();
      setFlash({ id: Date.now(), kind: 'play' });
    } else {
      video.pause();
      setFlash({ id: Date.now(), kind: 'pause' });
    }
  }, [play]);

  const skip = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.min(Math.max(sourceToEdited(edit, video.currentTime) + delta, 0), totalEdited);
      video.currentTime = editedToSource(edit, target);
      setFlash({ id: Date.now(), kind: delta < 0 ? 'back' : 'forward' });
    },
    [edit, totalEdited],
  );

  useEffect(() => {
    registerController({ seek: seekSource, play, pause: () => videoRef.current?.pause() });
    return () => registerController(null);
  }, [registerController, seekSource, play]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    localStorage.setItem('spool-volume', String(volume));
  }, [volume, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
    localStorage.setItem('spool-speed', String(speed));
  }, [speed]);

  useEffect(() => {
    localStorage.setItem('spool-captions', captions ? '1' : '0');
  }, [captions]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        event.preventDefault();
        if (event.target instanceof HTMLButtonElement) event.target.blur();
        togglePlay();
      } else if (key === 'arrowleft' || key === 'j') {
        event.preventDefault();
        skip(key === 'j' ? -10 : -5);
      } else if (key === 'arrowright' || key === 'l') {
        event.preventDefault();
        skip(key === 'l' ? 10 : 5);
      } else if (key === 'm') setMuted((m) => !m);
      else if (key === 'f') toggleFullscreen();
      else if (key === 'c') setCaptions((c) => !c);
      else return;
      pokeControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skip, toggleFullscreen, pokeControls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialSourceTime === undefined) return;
    const apply = () => {
      video.currentTime = initialSourceTime;
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
  }, [initialSourceTime, stableSrc]);

  const caption = captions ? segments.find((s) => sourceTime >= s.start && sourceTime <= s.end + 0.25) : undefined;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const showControls = controlsVisible || !playing;

  return (
    <div
      ref={rootRef}
      className={cn(
        'group/player relative w-full select-none overflow-hidden bg-black',
        fullscreen ? 'h-screen' : 'rounded-2xl border border-white/[0.07] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]',
        !showControls && 'cursor-none',
      )}
      onPointerMove={pokeControls}
      onPointerLeave={() => playing && setControlsVisible(false)}
    >
      <div
        ref={frameRef}
        className="flex w-full items-center justify-center"
        style={fullscreen ? { height: '100%' } : { aspectRatio: String(ratio), maxHeight }}
      >
        <div className="relative overflow-hidden" style={{ width: box.width || '100%', height: box.height || '100%' }}>
          <div ref={stageRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 50%' }}>
            {stableSrc && (
              <video
                ref={videoRef}
                src={stableSrc}
                poster={poster ?? undefined}
                playsInline
                preload="metadata"
                className="h-full w-full bg-black object-contain"
                onClick={togglePlay}
                onDoubleClick={toggleFullscreen}
                onPlay={() => {
                  setPlaying(true);
                  setStorePlaying(true);
                  pokeControls();
                  if (!startedRef.current) {
                    startedRef.current = true;
                    onFirstPlay?.();
                  }
                }}
                onPause={() => {
                  setPlaying(false);
                  setStorePlaying(false);
                  setControlsVisible(true);
                }}
                onWaiting={() => setWaiting(true)}
                onPlaying={() => setWaiting(false)}
                onCanPlay={() => setWaiting(false)}
                onProgress={(event) => {
                  const video = event.currentTarget;
                  const ranges = video.buffered;
                  for (let i = 0; i < ranges.length; i++) {
                    if (ranges.start(i) <= video.currentTime + 0.5 && ranges.end(i) >= video.currentTime) {
                      setBufferedSource(ranges.end(i));
                      return;
                    }
                  }
                }}
              />
            )}
            <BlurOverlays blurs={blurs} />
          </div>

          <AnimatePresence>
            {caption && (
              <motion.div
                key={caption.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'pointer-events-none absolute inset-x-0 flex justify-center px-8 transition-[bottom] duration-300',
                  showControls ? 'bottom-24' : 'bottom-8',
                )}
              >
                <span className="max-w-3xl rounded-lg bg-black/75 px-3 py-1.5 text-center text-[15px] font-medium leading-snug text-white backdrop-blur-sm">
                  {caption.text}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {!playing && (
            <motion.button
              key="big-play"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.15 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              onClick={togglePlay}
              className="pointer-events-auto relative flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-glow-lg"
              aria-label="Play"
            >
              <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-accent/60" />
              <Play className="ml-1 h-8 w-8 fill-current" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {flash && playing && (
            <motion.div
              key={flash.id}
              initial={{ opacity: 0.9, scale: 0.85 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              onAnimationComplete={() => setFlash(null)}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
            >
              {flash.kind === 'play' && <Play className="ml-0.5 h-7 w-7 fill-current" />}
              {flash.kind === 'pause' && <Pause className="h-7 w-7 fill-current" />}
              {flash.kind === 'back' && <RotateCcw className="h-7 w-7" />}
              {flash.kind === 'forward' && <RotateCw className="h-7 w-7" />}
            </motion.div>
          )}
        </AnimatePresence>
        {waiting && playing && !flash && (
          <span className="block h-12 w-12 animate-spin rounded-full border-[3px] border-white/15 border-t-accent" />
        )}
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: showControls ? 1 : 0, y: showControls ? 0 : 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className={cn('absolute inset-x-0 bottom-0 px-4 pb-3 pt-16', !showControls && 'pointer-events-none')}
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.35) 55%, transparent)' }}
      >
        <Scrubber
          duration={totalEdited}
          current={editedTime}
          buffered={sourceToEdited(edit, bufferedSource)}
          chapters={editedChapters}
          storyboard={storyboard}
          toSource={(t) => editedToSource(edit, t)}
          onSeek={(t) => seekSource(editedToSource(edit, t))}
          onScrubStart={() => {
            wasPlayingBeforeScrub.current = playing;
            videoRef.current?.pause();
          }}
          onScrubEnd={() => {
            if (wasPlayingBeforeScrub.current) play();
          }}
        />
        <div className="mt-1.5 flex items-center gap-1">
          <ControlButton label={playing ? 'Pause (k)' : 'Play (k)'} onClick={togglePlay}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={playing ? 'pause' : 'play'}
                initial={{ scale: 0.6, opacity: 0, rotate: -30 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.6, opacity: 0, rotate: 30 }}
                transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                className="flex"
              >
                {playing ? <Pause className="h-[18px] w-[18px] fill-current" /> : <Play className="h-[18px] w-[18px] fill-current" />}
              </motion.span>
            </AnimatePresence>
          </ControlButton>
          <ControlButton label="Back 5s (←)" onClick={() => skip(-5)}>
            <RotateCcw className="h-4 w-4" />
          </ControlButton>
          <ControlButton label="Forward 5s (→)" onClick={() => skip(5)}>
            <RotateCw className="h-4 w-4" />
          </ControlButton>
          <div className="group/vol flex items-center">
            <ControlButton label={muted ? 'Unmute (m)' : 'Mute (m)'} onClick={() => setMuted((m) => !m)}>
              <VolumeIcon className="h-[18px] w-[18px]" />
            </ControlButton>
            <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover/vol:w-20">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  setVolume(Number(event.target.value));
                  setMuted(false);
                }}
                className="w-[72px]"
                aria-label="Volume"
              />
            </div>
          </div>
          <span className="ml-2 font-mono text-xs tabular text-white/80">
            {formatTimestamp(editedTime)} <span className="text-white/35">/ {formatTimestamp(totalEdited)}</span>
          </span>
          <div className="flex-1" />
          <Menu
            align="end"
            trigger={(props) => (
              <ControlButton label="Playback speed" {...props}>
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <Gauge className="h-4 w-4" />
                  {speed}×
                </span>
              </ControlButton>
            )}
            items={[{ heading: 'Speed' }, ...SPEEDS.map((s) => ({ label: `${s}×`, checked: s === speed, onSelect: () => setSpeed(s) }))]}
          />
          {segments.length > 0 && (
            <ControlButton label="Captions (c)" onClick={() => setCaptions((c) => !c)} active={captions}>
              <Captions className="h-[18px] w-[18px]" />
            </ControlButton>
          )}
          <ControlButton label={fullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </ControlButton>
        </div>
      </motion.div>
    </div>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  active,
  ...rest
}: {
  children: React.ReactNode;
  label: string;
  onClick: (event: React.MouseEvent) => void;
  active?: boolean;
  'aria-expanded'?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-white/85 transition hover:bg-white/10 hover:text-white',
        active && 'text-accent',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
