const SESSION_KEY = 'spool-viewer-session';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable anonymous identity for analytics and AI chat history of signed-out viewers. */
export function viewerSession(): string {
  let session = localStorage.getItem(SESSION_KEY);
  if (!session || !/^[A-Za-z0-9_-]{8,64}$/.test(session)) {
    session = randomId();
    localStorage.setItem(SESSION_KEY, session);
  }
  return session;
}

export function getShareToken(shareId: string): string | null {
  const raw = sessionStorage.getItem(`spool-share:${shareId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token: string; expiresAt: string };
    if (new Date(parsed.expiresAt).getTime() < Date.now()) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

export function setShareToken(shareId: string, token: string, expiresAt: string): void {
  sessionStorage.setItem(`spool-share:${shareId}`, JSON.stringify({ token, expiresAt }));
}

export function createLocalId(): string {
  return randomId().slice(0, 16);
}

export function shareUrl(shareId: string, sourceTime?: number): string {
  const url = new URL(`/s/${shareId}`, window.location.origin);
  if (sourceTime !== undefined && sourceTime > 0) url.searchParams.set('t', String(Math.floor(sourceTime)));
  return url.toString();
}
