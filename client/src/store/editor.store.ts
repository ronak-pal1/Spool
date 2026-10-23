import { editedDuration, normalizeEdit, type EditConfig } from '@spool/shared';
import { create } from 'zustand';
import { toast } from './toast.store';

const MIN_KEPT_SECONDS = 0.5;

export type EditorSelection = { kind: 'blur'; id: string } | { kind: 'zoom'; id: string } | { kind: 'segment'; index: number } | null;

const HISTORY_LIMIT = 120;

interface EditorState {
  videoId: string | null;
  duration: number;
  edit: EditConfig;
  saved: EditConfig;
  past: EditConfig[];
  future: EditConfig[];
  gesture: boolean;
  selection: EditorSelection;
  /** Multiplier on top of the fit-to-width timeline scale. */
  timelineZoom: number;
  previewEdits: boolean;
  load: (videoId: string, duration: number, edit: EditConfig) => void;
  /** Applies a discrete change as one undo step. */
  update: (fn: (edit: EditConfig) => EditConfig) => void;
  /** Starts a drag: snapshots history once so the whole gesture undoes in one step. */
  beginGesture: () => void;
  updateGesture: (fn: (edit: EditConfig) => EditConfig) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (edit: EditConfig) => void;
  select: (selection: EditorSelection) => void;
  setTimelineZoom: (zoom: number) => void;
  setPreviewEdits: (value: boolean) => void;
}

const EMPTY: EditConfig = { version: 1, trim: { start: 0, end: 0 }, splits: [], cuts: [], blurs: [], zooms: [] };

export function editsEqual(a: EditConfig, b: EditConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Mirrors the server rule that an edit must keep at least half a second of video. */
function removesEverything(previous: EditConfig, next: EditConfig): boolean {
  if (editedDuration(next) >= MIN_KEPT_SECONDS || editedDuration(previous) < MIN_KEPT_SECONDS) return false;
  toast.info('Keep at least half a second', 'An edit cannot remove the entire video.');
  return true;
}

function selectionStillValid(selection: EditorSelection, edit: EditConfig): EditorSelection {
  if (!selection) return null;
  if (selection.kind === 'blur') return edit.blurs.some((b) => b.id === selection.id) ? selection : null;
  if (selection.kind === 'zoom') return edit.zooms.some((z) => z.id === selection.id) ? selection : null;
  return selection.index <= edit.splits.length ? selection : null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  videoId: null,
  duration: 0,
  edit: EMPTY,
  saved: EMPTY,
  past: [],
  future: [],
  gesture: false,
  selection: null,
  timelineZoom: 1,
  previewEdits: true,

  load: (videoId, duration, edit) => {
    const normalized = normalizeEdit(edit, duration);
    set({ videoId, duration, edit: normalized, saved: normalized, past: [], future: [], gesture: false, selection: null, timelineZoom: 1 });
  },

  update: (fn) => {
    const { edit, past, duration, selection } = get();
    const next = normalizeEdit(fn(edit), duration);
    if (editsEqual(next, edit)) return;
    if (removesEverything(edit, next)) return;
    set({ edit: next, past: [...past, edit].slice(-HISTORY_LIMIT), future: [], selection: selectionStillValid(selection, next) });
  },

  beginGesture: () => {
    const { edit, past, gesture } = get();
    if (gesture) return;
    set({ gesture: true, past: [...past, edit].slice(-HISTORY_LIMIT), future: [] });
  },

  updateGesture: (fn) => {
    if (!get().gesture) get().beginGesture();
    set({ edit: fn(get().edit) });
  },

  endGesture: () => {
    const { edit, past, duration, selection, gesture } = get();
    if (!gesture) return;
    const next = normalizeEdit(edit, duration);
    const before = past[past.length - 1];
    if (before && (editsEqual(before, next) || removesEverything(before, next))) {
      set({ gesture: false, edit: before, past: past.slice(0, -1) });
      return;
    }
    set({ gesture: false, edit: next, selection: selectionStillValid(selection, next) });
  },

  undo: () => {
    const { past, future, edit, selection, gesture } = get();
    if (gesture) return;
    const previous = past[past.length - 1];
    if (!previous) return;
    set({ edit: previous, past: past.slice(0, -1), future: [edit, ...future].slice(0, HISTORY_LIMIT), selection: selectionStillValid(selection, previous) });
  },

  redo: () => {
    const { past, future, edit, selection, gesture } = get();
    if (gesture) return;
    const next = future[0];
    if (!next) return;
    set({ edit: next, past: [...past, edit].slice(-HISTORY_LIMIT), future: future.slice(1), selection: selectionStillValid(selection, next) });
  },

  markSaved: (edit) => set({ saved: edit }),
  select: (selection) => set({ selection }),
  setTimelineZoom: (timelineZoom) => set({ timelineZoom: Math.min(20, Math.max(1, timelineZoom)) }),
  setPreviewEdits: (previewEdits) => set({ previewEdits }),
}));

export function useEditorDirty(): boolean {
  return useEditorStore((s) => !editsEqual(s.edit, s.saved));
}
