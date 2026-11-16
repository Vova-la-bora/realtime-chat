import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { WsTestClient } from './wsClient';

interface ReactionJson {
  emoji: string;
  count: number;
  userIds: number[];
}

describe('Реакции на сообщения', () => {
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let urlA: string;
  let urlB: string;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let roomId: number;
  const clients: WsTestClient[] = [];

  async function listen(app: FastifyInstance): Promise<string> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    return `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  async function connect(base: string, user: TestUser): Promise<WsTestClient> {
    const client = await WsTestClient.connect(`${base}/ws?token=${user.accessToken}`);
    clients.push(client);
    return client;
  }

  async function joinWs(client: WsTestClient, id: number): Promise<void> {
    client.send('join_room', { roomId: id });
    await client.sync();
  }

  async function send(client: WsTestClient, text: string): Promise<number> {
    client.send('send_message', { roomId, content: text, clientMsgId: randomUUID() });
    return (await client.next('message_ack')).payload.message.id;
  }

  async function historyReactions(user: TestUser, messageId: number): Promise<ReactionJson[]> {
    const res = await appA.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      headers: authHeader(user),
    });
    return res.json().items.find((m: { id: number }) => m.id === messageId).reactions;
  }

  beforeAll(async () => {
    // Два инстанса с общей БД: проверяем и обычную рассылку, и рассылку через шину
    appA = await createTestApp({ instanceId: 'inst-a', ownRedis: true });
    appB = await createTestApp({ instanceId: 'inst-b', ownRedis: true });
    urlA = await listen(appA);
    urlB = await listen(appB);
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
  });

  beforeEach(async () => {
    await resetDb();
    appA.container.getRoomService().cache.clear();
    appB.container.getRoomService().cache.clear();
    alice = await registerUser(appA, 'alice');
    bob = await registerUser(appA, 'bob');
    carol = await registerUser(appA, 'carol');
    roomId = await createRoom(appA, alice, 'general');
    await joinRoom(appA, bob, roomId);
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.close();
    }
  });

  it('реакция ставится и снимается повторным нажатием; обновление получают все подключения', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlA, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    const id = await send(a, 'Отличная новость');

    b.send('toggle_reaction', { messageId: id, emoji: '👍' });
    const forAuthor = await a.next('reaction_updated');
    const forClicker = await b.next('reaction_updated');
    expect(forAuthor.payload).toEqual({
      roomId,
      messageId: id,
      reactions: [{ emoji: '👍', count: 1, userIds: [bob.id] }],
    });
    expect(forClicker.payload).toEqual(forAuthor.payload);

    b.send('toggle_reaction', { messageId: id, emoji: '👍' });
    const removed = await a.next('reaction_updated');
    expect(removed.payload.reactions).toEqual([]);
    expect(await historyReactions(bob, id)).toEqual([]);
  });

  it('считает реакции разных пользователей и разных эмодзи', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlA, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    const id = await send(a, 'Голосуем');

    b.send('toggle_reaction', { messageId: id, emoji: '🔥' });
    await b.sync();
    a.send('toggle_reaction', { messageId: id, emoji: '🔥' });
    a.send('toggle_reaction', { messageId: id, emoji: '❤️' });
    // Команды одного подключения выполняются по порядку: pong приходит после обеих реакций
    await a.sync();

    const reactions = await historyReactions(bob, id);
    expect(reactions).toHaveLength(2);
    const fire = reactions.find((r) => r.emoji === '🔥');
    expect(fire?.count).toBe(2);
    expect([...(fire?.userIds ?? [])].sort((x, y) => x - y)).toEqual([alice.id, bob.id]);
    expect(reactions.find((r) => r.emoji === '❤️')).toEqual({
      emoji: '❤️',
      count: 1,
      userIds: [alice.id],
    });
  });

  it('быстрые повторные нажатия одного пользователя не оставляют лишних строк в БД', async () => {
    const b = await connect(urlA, bob);
    await joinWs(b, roomId);
    const id = await send(b, 'Гонка');

    // Чётное число нажатий подряд: в итоге реакции нет, и строк в таблице тоже нет
    for (let i = 0; i < 6; i++) {
      b.send('toggle_reaction', { messageId: id, emoji: '😂' });
    }
    await b.sync();
    const rows = await pool.query(
      'SELECT count(*)::int AS n FROM message_reactions WHERE message_id = $1',
      [id],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('отвергает неизвестное эмодзи, несуществующее сообщение и не-участника', async () => {
    const a = await connect(urlA, alice);
    const c = await connect(urlA, carol);
    await joinWs(a, roomId);
    const id = await send(a, 'Текст');

    a.send('toggle_reaction', { messageId: id, emoji: '💩' });
    expect((await a.next('error')).payload.code).toBe('validation_error');

    a.send('toggle_reaction', { messageId: id, emoji: 'текст' });
    expect((await a.next('error')).payload.code).toBe('validation_error');

    a.send('toggle_reaction', { messageId: 999999, emoji: '👍' });
    expect((await a.next('error')).payload.code).toBe('message_not_found');

    c.send('toggle_reaction', { messageId: id, emoji: '👍' });
    expect((await c.next('error')).payload.code).toBe('not_a_member');

    const rows = await pool.query('SELECT count(*)::int AS n FROM message_reactions');
    expect(rows.rows[0].n).toBe(0);
  });

  it('на удалённое сообщение реакцию поставить нельзя', async () => {
    const a = await connect(urlA, alice);
    await joinWs(a, roomId);
    const id = await send(a, 'Будет удалено');
    a.send('delete_message', { messageId: id });
    await a.next('message_deleted');

    a.send('toggle_reaction', { messageId: id, emoji: '👍' });
    expect((await a.next('error')).payload.code).toBe('message_deleted');
  });

  it('реакции приходят в истории и сохраняются после выхода пользователя из комнаты', async () => {
    const b = await connect(urlA, bob);
    await joinWs(b, roomId);
    const id = await send(b, 'С реакцией');
    b.send('toggle_reaction', { messageId: id, emoji: '🎉' });
    await b.next('reaction_updated');

    expect(await historyReactions(alice, id)).toEqual([
      { emoji: '🎉', count: 1, userIds: [bob.id] },
    ]);

    await appA.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/leave`,
      headers: authHeader(bob),
    });
    expect(await historyReactions(alice, id)).toHaveLength(1);
  });

  it('обновление реакций доходит до пользователя на другом инстансе', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlB, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    const id = await send(a, 'Через два инстанса');
    await b.next('new_message');

    b.send('toggle_reaction', { messageId: id, emoji: '😮' });
    const onA = await a.next('reaction_updated');
    const onB = await b.next('reaction_updated');
    expect(onA.payload).toEqual({
      roomId,
      messageId: id,
      reactions: [{ emoji: '😮', count: 1, userIds: [bob.id] }],
    });
    expect(onB.payload).toEqual(onA.payload);
  });

  it('новое сообщение приходит с пустым списком реакций', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlA, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    await send(a, 'Свежее');
    const incoming = await b.next('new_message');
    expect(incoming.payload.message.reactions).toEqual([]);
  });
});
