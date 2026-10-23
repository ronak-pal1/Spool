import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../middleware/validate.js';
import * as users from '../services/user.service.js';

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().email('Enter a valid email').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  })
  .strict();

export async function register(req: Request, res: Response) {
  const input = parse(registerSchema, req.body);
  res.status(201).json(await users.register(input));
}

export async function login(req: Request, res: Response) {
  const input = parse(loginSchema, req.body);
  res.json(await users.login(input));
}

export function me(req: Request, res: Response) {
  res.json(users.me(req.auth!.userId));
}

export async function updateMe(req: Request, res: Response) {
  const input = parse(updateSchema, req.body);
  res.json(await users.updateProfile(req.auth!.userId, input));
}
