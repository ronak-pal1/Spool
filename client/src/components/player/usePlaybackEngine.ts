import { activeBlurs, snapToKept, zoomStateAt, type BlurRegion, type EditConfig } from '@spool/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';

interface EngineOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  edit: EditConfig;
  /** When false the full source plays (editor "show original"), effects still render. */
  applyCuts: boolean;
  applyEffects?: boolean;
  onTick?: (sourceTime: number) => void;
  onEnded?: () => void;
}

/**
 * Frame-accurate, non-destructive playback of an edit decision list: skips trimmed and cut
 * ranges, drives the zoom camera with the same smoothstep curve used by the FFmpeg exporter,
 * and exposes the blur regions active at the current frame.
 */
export function usePlaybackEngine({ videoRef, stageRef, edit, applyCuts, applyEffects = true, onTick, onEnded }: EngineOptions) {
  const editRef = useRef(edit);
  const optionsRef = useRef({ applyCuts, applyEffects, onTick, onEnded });
  editRef.current = edit;
  optionsRef.current = { applyCuts, applyEffects, onTick, onEnded };
  const [blurs, setBlurs] = useState<BlurRegion[]>([]);
  const blurKey = useRef('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;

    const apply = () => {
      const current = editRef.current;
      const opts = optionsRef.current;
      let time = video.currentTime;

      if (opts.applyCuts && Number.isFinite(video.duration) && video.duration > 0) {
        const snap = snapToKept(current, time);
        if (snap.ended) {
          if (!video.paused) {
            video.pause();
            opts.onEnded?.();
          }
          if (Math.abs(time - snap.time) > 0.05) {
            video.currentTime = snap.time;
            time = snap.time;
          }
        } else if (snap.time - time > 0.04) {
          video.currentTime = snap.time;
          time = snap.time;
        }
      }

      const stage = stageRef.current;
      if (stage) {
        if (opts.applyEffects) {
          const zoom = zoomStateAt(current.zooms, time);
          stage.style.transformOrigin = `${zoom.focus.x * 100}% ${zoom.focus.y * 100}%`;
          stage.style.transform = zoom.scale > 1.0005 ? `scale(${zoom.scale.toFixed(4)})` : 'none';
        } else {
          stage.style.transform = 'none';
        }
      }

      const active = opts.applyEffects ? activeBlurs(current.blurs, time) : [];
      const key = active.map((b) => `${b.id}:${b.rect.x}:${b.rect.y}:${b.rect.width}:${b.rect.height}:${b.intensity}`).join('|');
      if (key !== blurKey.current) {
        blurKey.current = key;
        setBlurs(active);
      }
      opts.onTick?.(time);
    };

    const loop = () => {
      apply();
      if (!video.paused && !video.ended) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };
    const once = () => apply();

    video.addEventListener('play', start);
    video.addEventListener('playing', start);
    video.addEventListener('seeked', once);
    video.addEventListener('seeking', once);
    video.addEventListener('pause', once);
    video.addEventListener('loadedmetadata', once);
    video.addEventListener('timeupdate', once);
    once();
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('play', start);
      video.removeEventListener('playing', start);
      video.removeEventListener('seeked', once);
      video.removeEventListener('seeking', once);
      video.removeEventListener('pause', once);
      video.removeEventListener('loadedmetadata', once);
      video.removeEventListener('timeupdate', once);
    };
  }, [videoRef, stageRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.paused) video.dispatchEvent(new Event('timeupdate'));
  }, [edit, applyCuts, applyEffects, videoRef]);

  return { blurs };
}
