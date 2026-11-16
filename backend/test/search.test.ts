import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import {
  authHeader,
  createRoom,
  createTestApp,
  joinRoom,
  registerUser,
  resetDb,
  TestUser,
} from './helpers';

interface SearchItem {
  id: number;
  content: string;
  reactions: { emoji: string; count: number; userIds: number[] }[];
}

interface SearchResult {
  items: SearchItem[];
  hasMore: boolean;
  nextCursor: number | null;
}

describe('Поиск по сообщениям', () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let roomId: number;

  async function insert(room: number, sender: number, content: string): Promise<number> {
    const res = await pool.query(
      `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
       VALUES ($1, $2, gen_random_uuid(), $3) RETURNING id`,
      [room, sender, content],
    );
    return res.rows[0].id;
  }

  async function search(
    user: TestUser,
    query: string,
    extra = '',
    room = roomId,
  ): Promise<{ status: number; body: SearchResult & { error?: { code: string } } }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${room}/search?query=${encodeURIComponent(query)}${extra}`,
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
    app.container.getRoomService().cache.clear();
    alice = await registerUser(app, 'alice');
    bob = await registerUser(app, 'bob');
    carol = await registerUser(app, 'carol');
    roomId = await createRoom(app, alice, 'general');
    await joinRoom(app, bob, roomId);
  });

  it('находит сообщения по слову с учётом русской морфологии', async () => {
    const hit = await insert(roomId, alice.id, 'Мы обсуждаем архитектуру проекта');
    await insert(roomId, bob.id, 'Сегодня отличная погода');

    const { status, body } = await search(bob, 'архитектура');
    expect(status).toBe(200);
    expect(body.items.map((m) => m.id)).toEqual([hit]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('регистр запроса не важен, ничего не найдено — пустой список', async () => {
    const hit = await insert(roomId, alice.id, 'Релиз назначен на пятницу');

    expect((await search(alice, 'РЕЛИЗ')).body.items.map((m) => m.id)).toEqual([hit]);

    const empty = await search(alice, 'несуществующее');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it('понимает кавычки и исключение слов (синтаксис websearch)', async () => {
    const both = await insert(roomId, alice.id, 'Покупаем красный велосипед');
    const onlyRed = await insert(roomId, alice.id, 'Красный диван в гостиной');
    await insert(roomId, alice.id, 'Синий велосипед');

    const phrase = await search(bob, '"красный велосипед"');
    expect(phrase.body.items.map((m) => m.id)).toEqual([both]);

    const exclude = await search(bob, 'красный -велосипед');
    expect(exclude.body.items.map((m) => m.id)).toEqual([onlyRed]);
  });

  it('результаты идут от новых к старым, страницы связаны курсором и не повторяются', async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(await insert(roomId, alice.id, `Обсуждение релиза номер ${i}`));
      await insert(roomId, bob.id, `Посторонний разговор ${i}`);
    }

    const first = await search(bob, 'релиз', '&limit=2');
    expect(first.body.items.map((m) => m.id)).toEqual([ids[4], ids[3]]);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toBe(ids[3]);

    const second = await search(bob, 'релиз', `&limit=2&before_id=${first.body.nextCursor}`);
    expect(second.body.items.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    expect(second.body.hasMore).toBe(true);

    const last = await search(bob, 'релиз', `&limit=2&before_id=${second.body.nextCursor}`);
    expect(last.body.items.map((m) => m.id)).toEqual([ids[0]]);
    expect(last.body.hasMore).toBe(false);
    expect(last.body.nextCursor).toBeNull();
  });

  it('ищет только в указанной комнате', async () => {
    const other = await createRoom(app, alice, 'other');
    await insert(other, alice.id, 'Секретный план в другой комнате');
    const mine = await insert(roomId, alice.id, 'Открытый план в этой комнате');

    const { body } = await search(alice, 'план');
    expect(body.items.map((m) => m.id)).toEqual([mine]);
  });

  it('не показывает удалённые сообщения', async () => {
    const kept = await insert(roomId, alice.id, 'Договор подписан');
    const removed = await insert(roomId, alice.id, 'Договор отправлен на согласование');
    await pool.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [removed]);

    const { body } = await search(bob, 'договор');
    expect(body.items.map((m) => m.id)).toEqual([kept]);
  });

  it('после правки сообщение ищется по новому тексту, а не по старому', async () => {
    const id = await insert(roomId, alice.id, 'Встреча во вторник');
    expect((await search(bob, 'вторник')).body.items).toHaveLength(1);

    await app.container.getMessageService().edit(id, alice.id, 'Встреча в четверг');

    expect((await search(bob, 'вторник')).body.items).toHaveLength(0);
    const edited = await search(bob, 'четверг');
    expect(edited.body.items.map((m) => m.id)).toEqual([id]);
  });

  it('в найденных сообщениях приходят реакции', async () => {
    const id = await insert(roomId, alice.id, 'Победа в хакатоне');
    await app.container.getMessageService().toggleReaction(id, bob.id, '🎉');
    await app.container.getMessageService().toggleReaction(id, alice.id, '🎉');

    const { body } = await search(bob, 'хакатон');
    // Пользователи перечислены в порядке постановки реакции: сначала Боб, потом Алиса
    expect(body.items[0].reactions).toEqual([
      { emoji: '🎉', count: 2, userIds: [bob.id, alice.id] },
    ]);
  });

  it('не-участнику поиск запрещён, без токена — 401', async () => {
    await insert(roomId, alice.id, 'Закрытая информация');

    const denied = await search(carol, 'информация');
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('not_a_member');

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/search?query=информация`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('проверяет параметры: слишком короткий запрос, лимит вне диапазона', async () => {
    const short = await search(alice, 'а');
    expect(short.status).toBe(400);
    expect(short.body.error?.code).toBe('validation_error');

    const limit = await search(alice, 'привет', '&limit=500');
    expect(limit.status).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/search`,
      headers: authHeader(alice),
    });
    expect(missing.statusCode).toBe(400);
  });

  it('служебные символы в запросе не ломают поиск', async () => {
    await insert(roomId, alice.id, 'Обычное сообщение');
    for (const q of ["'; DROP TABLE messages; --", '& | ! ( ) :*', '"незакрытая кавычка']) {
      const { status } = await search(alice, q);
      expect(status).toBe(200);
    }
    const count = await pool.query('SELECT count(*)::int AS n FROM messages');
    expect(count.rows[0].n).toBe(1);
  });
});
