import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { buildApp } from '../src/app';
import { pool } from '../src/db';

// Вместо настоящего Redis в тестах работает его эмуляция в памяти
export const testRedis = new RedisMock();

export interface TestUser {
  id: number;
  username: string;
  accessToken: string;
  refreshToken: string;
}

interface TestAppOptions {
  instanceId?: string;
  // Свой экземпляр эмуляции Redis (данные и Pub/Sub общие): так в одном процессе работают два инстанса
  ownRedis?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<FastifyInstance> {
  const redis = options.ownRedis ? new RedisMock() : testRedis;
  const app = await buildApp({
    redis: redis as unknown as Redis,
    instanceId: options.instanceId,
  });
  await app.ready();
  return app;
}

// Полная очистка данных между тестами
export async function resetDb(): Promise<void> {
  await pool.query(
    'TRUNCATE messages, room_members, rooms, refresh_tokens, users RESTART IDENTITY CASCADE',
  );
  await testRedis.flushall();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function registerUser(
  app: FastifyInstance,
  username: string,
  password = 'password123',
): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, email: `${username}@example.com`, password },
  });
  const body = res.json();
  const cookie = res.cookies.find((c) => c.name === 'refresh_token');
  return {
    id: body.user.id,
    username,
    accessToken: body.accessToken,
    refreshToken: cookie?.value ?? '',
  };
}

export function authHeader(user: TestUser): { authorization: string } {
  return { authorization: `Bearer ${user.accessToken}` };
}

// Создаёт группу и возвращает её id
export async function createRoom(
  app: FastifyInstance,
  owner: TestUser,
  name: string,
  type: 'public' | 'private' = 'public',
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/rooms',
    headers: authHeader(owner),
    payload: { name, type },
  });
  return res.json().room.id;
}

// Вход в публичную комнату через REST
export async function joinRoom(
  app: FastifyInstance,
  user: TestUser,
  roomId: number,
): Promise<void> {
  await app.inject({
    method: 'POST',
    url: `/api/rooms/${roomId}/join`,
    headers: authHeader(user),
  });
}

// Быстро добавляет N сообщений напрямую в БД
export async function seedMessages(roomId: number, senderId: number, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
     SELECT $1, $2, gen_random_uuid(), 'msg ' || g FROM generate_series(1, $3::int) AS g`,
    [roomId, senderId, count],
  );
}
