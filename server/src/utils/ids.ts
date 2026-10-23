import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const createId = customAlphabet(alphabet, 21);
export const createShareId = customAlphabet(alphabet, 12);
export const createShortId = customAlphabet(alphabet, 8);

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40);
  return `${base || 'workspace'}-${createShortId().toLowerCase()}`;
}

const AVATAR_COLORS = ['#00FA9A', '#5B8CFF', '#FF7A59', '#C084FC', '#FACC15', '#22D3EE', '#F472B6', '#A3E635'];

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}
