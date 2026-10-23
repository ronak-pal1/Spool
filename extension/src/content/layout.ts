import type { Point } from './dom';

export type BubbleSize = 's' | 'm' | 'l';

export const BUBBLE_DIAMETERS: Record<BubbleSize, number> = { s: 128, m: 196, l: 300 };

export interface OverlayLayout {
  bar: Point | null;
  bubble: Point | null;
  bubbleSize: BubbleSize;
}

const LAYOUT_KEY = 'spool:overlay-layout';

const DEFAULT_LAYOUT: OverlayLayout = { bar: null, bubble: null, bubbleSize: 'm' };

/** Bar and bubble positions are shared across tabs so the overlay stays put while switching. */
export async function readLayout(): Promise<OverlayLayout> {
  const stored = await chrome.storage.local.get(LAYOUT_KEY);
  return { ...DEFAULT_LAYOUT, ...(stored[LAYOUT_KEY] as Partial<OverlayLayout> | undefined) };
}

export async function writeLayout(patch: Partial<OverlayLayout>): Promise<void> {
  const next = { ...(await readLayout()), ...patch };
  await chrome.storage.local.set({ [LAYOUT_KEY]: next });
}

export function subscribeLayout(listener: (layout: OverlayLayout) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(LAYOUT_KEY in changes)) return;
    listener({ ...DEFAULT_LAYOUT, ...(changes[LAYOUT_KEY]?.newValue as Partial<OverlayLayout> | undefined) });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
