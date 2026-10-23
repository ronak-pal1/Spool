import crypto from 'node:crypto';
import { env } from '../config/env.js';

function hmac(payload: string): string {
  return crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('base64url');
}

export function sign(payload: string): string {
  return hmac(payload);
}

export function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(hmac(payload));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/**
 * Returns an expiry aligned to an hour boundary so signed URLs stay byte-identical across
 * refetches within the same window; players can keep their buffered media.
 */
export function alignedExpiry(minTtlSeconds: number): number {
  const hour = 3600;
  const now = Math.floor(Date.now() / 1000);
  return Math.ceil((now + minTtlSeconds) / hour) * hour;
}
