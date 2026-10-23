import { formatTimestamp, type SearchResult } from '@spool/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, FileText, Film, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/store/ui.store';
import { Kbd, Spinner } from '../ui/misc';

interface FlatItem {
  key: string;
  result: SearchResult;
  start: number | null;
  text: string | null;
  kind: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** ⌘K palette: hybrid keyword + semantic search across every transcript in the workspace. */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query.trim(), 220);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const search = useQuery({
    queryKey: queryKeys.search(debounced),
    queryFn: ({ signal }) => api.search(debounced, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo<FlatItem[]>(() => {
    const flat: FlatItem[] = [];
    for (const result of search.data ?? []) {
      flat.push({ key: `${result.video.id}-video`, result, start: null, text: null, kind: 'video' });
      for (const match of result.matches.filter((m) => m.start !== null).slice(0, 2)) {
        flat.push({ key: `${result.video.id}-${match.start}`, result, start: match.start, text: match.text, kind: match.kind });
      }
    }
    return flat;
  }, [search.data]);

  useEffect(() => setIndex(0), [items.length]);

  const go = (item: FlatItem) => {
    setOpen(false);
    navigate(`/s/${item.result.video.shareId}${item.start !== null ? `?t=${Math.floor(item.start)}` : ''}`);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 shadow-pop backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
              <Search className="h-4 w-4 text-white/40" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setIndex((i) => Math.min(items.length - 1, i + 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setIndex((i) => Math.max(0, i - 1));
                  }
                  if (e.key === 'Enter' && items[index]) go(items[index]);
                }}
                placeholder="Search titles, transcripts and topics — try “pricing decision”"
                className="h-14 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/30 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {search.isFetching && <Spinner className="h-4 w-4" />}
              <Kbd>esc</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {debounced.length < 2 && (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <Sparkles className="h-5 w-5 text-accent" />
                  <p className="text-sm text-white/60">Search every word spoken across your workspace.</p>
                  <p className="text-xs text-white/35">Semantic matches find moments even when the exact words differ.</p>
                </div>
              )}
              {debounced.length >= 2 && !search.isFetching && items.length === 0 && (
                <p className="px-6 py-10 text-center text-sm text-white/45">No Spools match “{debounced}”.</p>
              )}
              {items.map((item, i) => {
                const active = i === index;
                const isVideo = item.kind === 'video';
                return (
                  <button
                    key={item.key}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => go(item)}
                    className={cn(
                      'relative flex w-full items-center gap-3 rounded-xl px-3 text-left transition-colors',
                      isVideo ? 'py-2.5' : 'py-2 pl-[52px]',
                      active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                    )}
                  >
                    {active && <motion.span layoutId="palette-active" className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent" />}
                    {isVideo ? (
                      <>
                        <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md border border-white/10 bg-ink-700">
                          {item.result.video.thumbnailUrl ? (
                            <img src={item.result.video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Film className="m-auto mt-3 h-4 w-4 text-white/30" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-white">{item.result.video.title}</span>
                          <span className="block truncate text-xs text-white/40">
                            {item.result.video.owner.name} · {formatTimestamp(item.result.video.editedDurationSec)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="shrink-0 rounded-md border border-accent/25 bg-accent/10 px-1.5 py-px font-mono text-2xs text-accent">
                          {formatTimestamp(item.start ?? 0)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-white/60">{item.text}</span>
                        {item.kind === 'semantic' ? (
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent/60" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 shrink-0 text-white/25" />
                        )}
                      </>
                    )}
                    {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-white/30" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2.5 text-2xs text-white/35">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> open at moment
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-accent/70" /> semantic match
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
