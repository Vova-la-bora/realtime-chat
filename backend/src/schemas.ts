import { z } from 'zod';

// Схемы валидации входных данных REST API

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Допустимы только латинские буквы, цифры и _'),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(50).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
});

export const searchUsersSchema = z.object({
  query: z.string().trim().min(1).max(50),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(['public', 'private']),
});

export const userIdBodySchema = z.object({
  userId: z.number().int().positive(),
});

export const publicRoomsQuerySchema = z.object({
  query: z.string().trim().max(50).optional(),
  cursor: z.coerce.number().int().positive().optional(),
});

export const searchMessagesQuerySchema = z.object({
  query: z.string().trim().min(2).max(100),
  before_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const historyQuerySchema = z.object({
  before_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
