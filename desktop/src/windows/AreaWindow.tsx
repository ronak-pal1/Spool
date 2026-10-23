import { useEffect, useState } from 'react';

import { errorMessage, recorder } from '../lib/bridge';

interface Drag {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function AreaWindow() {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void recorder.cancelArea();
      if (event.key === 'Enter' && drag && drag.width >= 64 && drag.height >= 64) void confirm(drag);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  function confirm(rect: Drag) {
    void recorder.completeArea(rect).catch((caught) => setError(errorMessage(caught)));
  }

  return (
    <div
      className="relative h-full w-full cursor-crosshair bg-black/45"
      onMouseDown={(event) => {
        setOrigin({ x: event.clientX, y: event.clientY });
        setDrag({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
      }}
      onMouseMove={(event) => {
        if (!origin) return;
        const x = Math.min(origin.x, event.clientX);
        const y = Math.min(origin.y, event.clientY);
        setDrag({ x, y, width: Math.abs(event.clientX - origin.x), height: Math.abs(event.clientY - origin.y) });
      }}
      onMouseUp={() => setOrigin(null)}
    >
      {drag && drag.width > 2 ? (
        <div className="absolute border-2 border-accent bg-accent/10 shadow-glow" style={{ left: drag.x, top: drag.y, width: drag.width, height: drag.height }}>
          <span className="absolute -top-7 left-0 rounded-md bg-ink-950/90 px-2 py-0.5 font-mono text-xs text-accent">
            {Math.round(drag.width)}×{Math.round(drag.height)}
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-full bg-ink-950/80 px-4 py-2 text-sm text-white/80">
          Drag to choose what Spool records
        </div>
      )}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2">
        <button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-sm" onClick={() => void recorder.cancelArea()}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!drag || drag.width < 64 || drag.height < 64}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
          onClick={() => drag && confirm(drag)}
        >
          Use this area
        </button>
      </div>
      {error ? <p className="absolute bottom-20 left-1/2 -translate-x-1/2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
