import { useEffect, useRef } from 'react';

import { recorder, useRecording } from '../lib/bridge';

interface Stroke {
  points: { x: number; y: number }[];
  born: number;
}

const HOLD_MS = 2200;
const FADE_MS = 650;

export function DrawWindow() {
  const snapshot = useRecording();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<Stroke | null>(null);
  const enabled = snapshot.drawEnabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      const now = performance.now();
      strokes.current = strokes.current.filter((stroke) => now - stroke.born < HOLD_MS + FADE_MS);
      const paint = (stroke: Stroke, alpha: number) => {
        if (stroke.points.length < 2) return;
        context.beginPath();
        const first = stroke.points[0];
        if (!first) return;
        context.moveTo(first.x * ratio, first.y * ratio);
        for (const point of stroke.points.slice(1)) context.lineTo(point.x * ratio, point.y * ratio);
        context.strokeStyle = `rgba(0, 250, 154, ${alpha})`;
        context.lineWidth = 4 * ratio;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.shadowColor = 'rgba(0, 250, 154, 0.8)';
        context.shadowBlur = 12;
        context.stroke();
      };
      for (const stroke of strokes.current) {
        const age = now - stroke.born;
        const alpha = age < HOLD_MS ? 1 : Math.max(0, 1 - (age - HOLD_MS) / FADE_MS);
        paint(stroke, alpha);
      }
      if (active.current) paint(active.current, 1);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (enabled) return;
    strokes.current = [];
    active.current = null;
  }, [enabled]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && enabled) void recorder.setDrawEnabled(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{ pointerEvents: enabled ? 'auto' : 'none' }}
      onPointerDown={(event) => {
        if (!enabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        active.current = { points: [{ x: event.clientX, y: event.clientY }], born: performance.now() };
      }}
      onPointerMove={(event) => {
        if (!active.current) return;
        active.current.points.push({ x: event.clientX, y: event.clientY });
      }}
      onPointerUp={() => {
        if (active.current) strokes.current.push({ ...active.current, born: performance.now() });
        active.current = null;
      }}
    />
  );
}
