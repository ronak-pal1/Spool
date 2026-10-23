import { useEffect, useRef, useState, type RefObject } from 'react';

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Signed media URLs rotate their query string on refetch. Keep the first URL for a given
 * object so the <video> element never reloads (and loses its buffer) during background polling.
 */
export function useStableUrl(url: string | null | undefined): string | null {
  const ref = useRef<string | null>(url ?? null);
  if (!url) {
    ref.current = null;
  } else if (!ref.current || stripQuery(ref.current) !== stripQuery(url)) {
    ref.current = url;
  }
  return ref.current;
}

export interface BoxSize {
  width: number;
  height: number;
}

/** Largest box with the given aspect ratio that fits inside the observed container. */
export function useFitBox(containerRef: RefObject<HTMLElement | null>, ratio: number): BoxSize {
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const safeRatio = ratio > 0 ? ratio : 16 / 9;
      let w = width;
      let h = width / safeRatio;
      if (h > height) {
        h = height;
        w = height * safeRatio;
      }
      setSize((prev) => (Math.abs(prev.width - w) < 0.5 && Math.abs(prev.height - h) < 0.5 ? prev : { width: w, height: h }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, ratio]);
  return size;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}
