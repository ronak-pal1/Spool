import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/store/toast.store';

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export async function copyText(text: string, label = 'Link copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) toast.success(label);
    else toast.error('Could not copy to clipboard');
    return ok;
  }
}

/** Returns a `copied` flag that flips back after a moment, for check-mark feedback on copy buttons. */
export function useCopyFeedback(): [boolean, (text: string, label?: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((text: string, label?: string) => {
    void copyText(text, label).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  }, []);
  return [copied, copy];
}

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Spool` : 'Spool';
  }, [title]);
}
