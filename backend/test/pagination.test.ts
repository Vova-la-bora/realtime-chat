import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import {
  authHeader,
  createRoom,
  createTestApp,
  registerUser,
  resetDb,
  seedMessages,
  TestUser,
} from './helpers';

interface HistoryPage {
  items: { id: number; content: string }[];
  hasMore: boolean;
  nextCursor: number | null;
}

describe('Курсорная пагинация истории', () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let roomId: number;

  async function fetchPage(
    user: TestUser,
    query = '',
  ): Promise<{ status: number; body: HistoryPage }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages${query}`,
      headers: authHeader(user),
    });
    return { status: res.statusCode, body: res.json() };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    alice = await registerUser(app, 'alice');
    roomId = await createRoom(app, alice, 'general');
    await seedMessages(roomId, alice.id, 120);
  });

  it('первая страница: 50 новейших сообщений по убыванию id', async () => {
    const { status, body } = await fetchPage(alice);
    expect(status).toBe(200);
    expect(body.items).toHaveLength(50);
    expect(body.hasMore).toBe(true);
    const ids = body.items.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(ids[0]).toBe(120);
    expect(body.nextCursor).toBe(ids[ids.length - 1]);
  });

  it('обход всех страниц отдаёт каждое сообщение ровно один раз, без пропусков', async () => {
    const seen: number[] = [];
    let cursor: number | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? '' : `?before_id=${cursor}`;
      const { body } = await fetchPage(alice, query);
      seen.push(...body.items.map((m) => m.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i));
  });

  it('последняя страница: hasMore=false и nextCursor=null', async () => {
    const { body } = await fetchPage(alice, '?before_id=21');
    expect(body.items).toHaveLength(20);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('новые сообщения во время чтения не создают дублей на следующих страницах', async () => {
    const first = await fetchPage(alice);
    await seedMessages(roomId, alice.id, 10);
    const second = await fetchPage(alice, `?before_id=${first.body.nextCursor}`);
    const firstIds = new Set(first.body.items.map((m) => m.id));
    expect(second.body.items.some((m) => firstIds.has(m.id))).toBe(false);
    expect(second.body.items[0].id).toBe(first.body.nextCursor! - 1);
  });

  it('учитывает параметр limit и отклоняет недопустимые значения', async () => {
    const small = await fetchPage(alice, '?limit=10');
    expect(small.body.items).toHaveLength(10);
    expect(small.body.hasMore).toBe(true);

    const zero = await fetchPage(alice, '?limit=0');
    expect(zero.status).toBe(400);
    const tooBig = await fetchPage(alice, '?limit=101');
    expect(tooBig.status).toBe(400);
  });

  it('не отдаёт историю не-участнику комнаты', async () => {
    const bob = await registerUser(app, 'bob');
    const { status } = await fetchPage(bob);
    expect(status).toBe(403);
  });

  it('вместо текста удалённого сообщения возвращает заглушку', async () => {
    await pool.query('UPDATE messages SET deleted_at = now() WHERE room_id = $1 AND id = 120', [
      roomId,
    ]);
    const { body } = await fetchPage(alice, '?limit=1');
    expect(body.items[0].content).toBe('сообщение удалено');
  });

  it('требует авторизацию', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages` });
    expect(res.statusCode).toBe(401);
  });
});
