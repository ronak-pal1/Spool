import type { z } from 'zod';
import { HttpError } from '../utils/http-error.js';

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw HttpError.badRequest(`${where}${first?.message ?? 'Invalid request'}`, result.error.flatten());
  }
  return result.data;
}
