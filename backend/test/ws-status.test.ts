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
  seedMessages,
  sleep,
  testRedis,
  TestUser,
} from './helpers';
import { WsTestClient } from './wsClient';

interface MemberJson {
  userId: number;
  online: boolean;
  lastSeenAt: string | null;
  lastReadMessageId: number;
}

describe('WebSocket: статусы, прочитанное, правка и личные диалоги', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let roomId: number;
  const clients: WsTestClient[] = [];

  async function connect(user: TestUser): Promise<WsTestClient> {
    const client = await WsTestClient.connect(`${baseUrl}/ws?token=${user.accessToken}`);
    clients.push(client);
    return client;
  }

  async function joinWs(client: WsTestClient, id: number): Promise<void> {
    client.send('join_room', { roomId: id });
    await client.sync();
  }

  async function members(user: TestUser, id = roomId): Promise<MemberJson[]> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${id}/members`,
      headers: authHeader(user),
    });
    return res.json().items;
  }

  async function unreadOf(user: TestUser, id = roomId): Promise<number> {
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(user) });
    return res.json().items.find((r: { id: number }) => r.id === id).unread;
  }

  async function messageIds(id = roomId): Promise<number[]> {
    const res = await pool.query('SELECT id FROM messages WHERE room_id = $1 ORDER BY id', [id]);
    return res.rows.map((row) => row.id);
  }

  async function send(client: WsTestClient, text: string, id = roomId): Promise<number> {
    client.send('send_message', { roomId: id, content: text, clientMsgId: randomUUID() });
    const ack = await client.next('message_ack');
    return ack.payload.message.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    // После сброса БД id комнат начинаются заново, поэтому кэш комнат тоже нужно очистить
    app.container.getRoomService().cache.clear();
    alice = await registerUser(app, 'alice');
    bob = await registerUser(app, 'bob');
    carol = await registerUser(app, 'carol');
    roomId = await createRoom(app, alice, 'general');
    await joinRoom(app, bob, roomId);
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.close();
    }
  });

  describe('онлайн-статусы', () => {
    it('сообщает «онлайн» при подключении и «офлайн» с last_seen при закрытии последнего подключения', async () => {
      const a = await connect(alice);
      await joinWs(a, roomId);

      const tab = await connect(bob);
      const online = await a.next('presence_update', 3000, (f) => f.payload.userId === bob.id);
      expect(online.payload.online).toBe(true);

      tab.close();
      const offline = await a.next(
        'presence_update',
        3000,
        (f) => f.payload.userId === bob.id && f.payload.online === false,
      );
      expect(offline.payload.lastSeenAt).toBeTruthy();

      const row = await pool.query('SELECT last_seen_at FROM users WHERE id = $1', [bob.id]);
      expect(row.rows[0].last_seen_at).not.toBeNull();
    });

    it('при нескольких вкладках пользователь онлайн, пока открыта хотя бы одна', async () => {
      const a = await connect(alice);
      await joinWs(a, roomId);

      const tab1 = await connect(bob);
      await a.next('presence_update', 3000, (f) => f.payload.userId === bob.id);
      const tab2 = await connect(bob);
      await sleep(200);
      await a.sync();
      // Вторая вкладка не вызывает повторного «онлайн»
      expect(a.buffered('presence_update', (f) => f.payload.userId === bob.id)).toBe(0);

      tab1.close();
      await sleep(300);
      await a.sync();
      expect(a.buffered('presence_update', (f) => f.payload.userId === bob.id)).toBe(0);
      expect((await members(alice)).find((m) => m.userId === bob.id)?.online).toBe(true);

      tab2.close();
      const offline = await a.next(
        'presence_update',
        3000,
        (f) => f.payload.userId === bob.id && f.payload.online === false,
      );
      expect(offline.payload.online).toBe(false);
      expect((await members(alice)).find((m) => m.userId === bob.id)?.online).toBe(false);
    });

    it('список участников показывает статус и last_seen', async () => {
      expect((await members(alice)).find((m) => m.userId === bob.id)).toMatchObject({
        online: false,
        lastSeenAt: null,
        lastReadMessageId: 0,
      });

      const tab = await connect(bob);
      await sleep(200);
      expect((await members(alice)).find((m) => m.userId === bob.id)?.online).toBe(true);

      tab.close();
      await sleep(300);
      const after = (await members(alice)).find((m) => m.userId === bob.id);
      expect(after?.online).toBe(false);
      expect(after?.lastSeenAt).toBeTruthy();
    });

    it('просроченные записи подключений не считаются, живые считаются (TTL)', async () => {
      await testRedis.zadd(`presence:${bob.id}`, Date.now() - 1000, 'ghost');
      expect((await members(alice)).find((m) => m.userId === bob.id)?.online).toBe(false);

      await testRedis.zadd(`presence:${bob.id}`, Date.now() + 60000, 'alive');
      expect((await members(alice)).find((m) => m.userId === bob.id)?.online).toBe(true);
    });
  });

  describe('«печатает…»', () => {
    it('рассылает user_typing остальным и не отправляет автору и его другим вкладкам', async () => {
      const a = await connect(alice);
      const b1 = await connect(bob);
      const b2 = await connect(bob);
      await joinWs(a, roomId);
      await joinWs(b1, roomId);
      await joinWs(b2, roomId);

      b1.send('typing', { roomId });
      const frame = await a.next('user_typing');
      expect(frame.payload).toEqual({ roomId, userId: bob.id });

      await b1.sync();
      await b2.sync();
      expect(b1.buffered('user_typing')).toBe(0);
      expect(b2.buffered('user_typing')).toBe(0);
    });

    it('не принимает typing от не-участника', async () => {
      const a = await connect(alice);
      const c = await connect(carol);
      await joinWs(a, roomId);

      c.send('typing', { roomId });
      expect((await c.next('error')).payload.code).toBe('not_a_member');
      await a.sync();
      expect(a.buffered('user_typing')).toBe(0);
    });
  });

  describe('прочитано и непрочитанные', () => {
    it('mark_read сбрасывает счётчик и сообщает остальным подключениям', async () => {
      await seedMessages(roomId, alice.id, 5);
      const ids = await messageIds();
      expect(await unreadOf(bob)).toBe(5);

      const a = await connect(alice);
      const b1 = await connect(bob);
      const b2 = await connect(bob);
      await joinWs(a, roomId);
      await joinWs(b1, roomId);
      await joinWs(b2, roomId);

      b1.send('mark_read', { roomId, messageId: ids[ids.length - 1] });
      const seenByAlice = await a.next('message_read');
      expect(seenByAlice.payload).toEqual({
        roomId,
        userId: bob.id,
        messageId: ids[ids.length - 1],
      });
      // Другая вкладка Боба тоже узнаёт и может сбросить свой счётчик
      const seenByTab = await b2.next('message_read');
      expect(seenByTab.payload.userId).toBe(bob.id);

      await b1.sync();
      expect(await unreadOf(bob)).toBe(0);
      expect((await members(alice)).find((m) => m.userId === bob.id)?.lastReadMessageId).toBe(
        ids[ids.length - 1],
      );
    });

    it('частичное прочтение уменьшает счётчик, отметка не двигается назад', async () => {
      await seedMessages(roomId, alice.id, 5);
      const ids = await messageIds();
      const a = await connect(alice);
      const b = await connect(bob);
      await joinWs(a, roomId);
      await joinWs(b, roomId);

      b.send('mark_read', { roomId, messageId: ids[2] });
      await a.next('message_read');
      expect(await unreadOf(bob)).toBe(2);

      b.send('mark_read', { roomId, messageId: ids[0] });
      await b.sync();
      await a.sync();
      expect(a.buffered('message_read')).toBe(0);
      expect(await unreadOf(bob)).toBe(2);
    });

    it('собственные сообщения не считаются непрочитанными', async () => {
      const b = await connect(bob);
      await send(b, 'мой текст');
      expect(await unreadOf(bob)).toBe(0);
      expect(await unreadOf(alice)).toBe(1);
    });

    it('отвергает mark_read для чужого сообщения, несуществующего id и не-участника', async () => {
      const otherRoom = await createRoom(app, carol, 'other');
      await seedMessages(otherRoom, carol.id, 1);
      const foreign = (await messageIds(otherRoom))[0];
      const b = await connect(bob);
      const c = await connect(carol);

      b.send('mark_read', { roomId, messageId: foreign });
      expect((await b.next('error')).payload.code).toBe('invalid_message');

      b.send('mark_read', { roomId, messageId: 999999 });
      expect((await b.next('error')).payload.code).toBe('invalid_message');

      c.send('mark_read', { roomId, messageId: 1 });
      expect((await c.next('error')).payload.code).toBe('not_a_member');
    });
  });

  describe('правка и удаление', () => {
    it('автор редактирует сообщение: все подключения получают message_edited с отметкой', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      await joinWs(a, roomId);
      await joinWs(b, roomId);
      const id = await send(a, 'Опечатка');

      a.send('edit_message', { messageId: id, content: 'Исправлено' });
      const forAuthor = await a.next('message_edited');
      const forPeer = await b.next('message_edited');
      expect(forAuthor.payload.message).toMatchObject({ id, content: 'Исправлено' });
      expect(forAuthor.payload.message.editedAt).toBeTruthy();
      expect(forPeer.payload.message.content).toBe('Исправлено');

      const history = await app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: authHeader(bob),
      });
      expect(history.json().items[0]).toMatchObject({ id, content: 'Исправлено' });
      expect(history.json().items[0].editedAt).toBeTruthy();
    });

    it('не даёт редактировать чужое, несуществующее и после выхода из комнаты', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      await joinWs(a, roomId);
      const id = await send(a, 'Текст Алисы');

      b.send('edit_message', { messageId: id, content: 'Взлом' });
      expect((await b.next('error')).payload.code).toBe('forbidden');

      a.send('edit_message', { messageId: 999999, content: 'нет такого' });
      expect((await a.next('error')).payload.code).toBe('message_not_found');

      a.send('edit_message', { messageId: id, content: '' });
      expect((await a.next('error')).payload.code).toBe('validation_error');

      await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/leave`,
        headers: authHeader(alice),
      });
      a.send('edit_message', { messageId: id, content: 'Я уже вышла' });
      expect((await a.next('error')).payload.code).toBe('not_a_member');

      const row = await pool.query('SELECT content FROM messages WHERE id = $1', [id]);
      expect(row.rows[0].content).toBe('Текст Алисы');
    });

    it('удаление мягкое: рассылается message_deleted, в истории заглушка, повтор ничего не рассылает', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      await joinWs(a, roomId);
      await joinWs(b, roomId);
      const id = await send(a, 'Секрет');

      a.send('delete_message', { messageId: id });
      const frame = await b.next('message_deleted');
      expect(frame.payload).toEqual({ roomId, messageId: id });
      await a.next('message_deleted');

      const row = await pool.query('SELECT content, deleted_at FROM messages WHERE id = $1', [id]);
      expect(row.rows[0].content).toBe('Секрет');
      expect(row.rows[0].deleted_at).not.toBeNull();

      const history = await app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: authHeader(bob),
      });
      expect(history.json().items[0]).toMatchObject({
        content: 'сообщение удалено',
        deleted: true,
      });

      a.send('delete_message', { messageId: id });
      await a.sync();
      await b.sync();
      expect(b.buffered('message_deleted')).toBe(0);
    });

    it('чужое сообщение удалить нельзя, удалённое редактировать нельзя', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      await joinWs(a, roomId);
      const id = await send(a, 'Текст');

      b.send('delete_message', { messageId: id });
      expect((await b.next('error')).payload.code).toBe('forbidden');

      a.send('delete_message', { messageId: id });
      await a.next('message_deleted');
      a.send('edit_message', { messageId: id, content: 'Воскрешение' });
      expect((await a.next('error')).payload.code).toBe('message_deleted');
    });

    it('удалённые сообщения не попадают в счётчик непрочитанных', async () => {
      const a = await connect(alice);
      await joinWs(a, roomId);
      const first = await send(a, 'раз');
      await send(a, 'два');
      await send(a, 'три');
      expect(await unreadOf(bob)).toBe(3);

      a.send('delete_message', { messageId: first });
      await a.next('message_deleted');
      expect(await unreadOf(bob)).toBe(2);
    });
  });

  describe('личные диалоги и автоподписка', () => {
    it('собеседник получает сообщения нового диалога без join_room', async () => {
      const a = await connect(alice);
      const b = await connect(bob);

      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms/direct',
        headers: authHeader(alice),
        payload: { userId: bob.id },
      });
      expect(res.statusCode).toBe(200);
      const directId = res.json().room.id;

      const id = await send(a, 'Привет лично', directId);
      const incoming = await b.next('new_message');
      expect(incoming.payload.message).toMatchObject({ id, roomId: directId });

      // Для Боба диалог виден в списке с собеседником и счётчиком
      const rooms = await app.inject({
        method: 'GET',
        url: '/api/rooms',
        headers: authHeader(bob),
      });
      const direct = rooms.json().items.find((r: { id: number }) => r.id === directId);
      expect(direct).toMatchObject({ type: 'direct', title: 'alice', unread: 1 });
    });

    it('прочитано в личном диалоге: отметка собеседника видна в списке участников', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms/direct',
        headers: authHeader(alice),
        payload: { userId: bob.id },
      });
      const directId = res.json().room.id;
      const id = await send(a, 'Прочитай меня', directId);

      b.send('mark_read', { roomId: directId, messageId: id });
      const read = await a.next('message_read');
      expect(read.payload).toEqual({ roomId: directId, userId: bob.id, messageId: id });

      const peer = (await members(alice, directId)).find((m) => m.userId === bob.id);
      expect(peer?.lastReadMessageId).toBe(id);
    });

    it('приглашённый в приватную комнату получает события без join_room', async () => {
      const privateId = await createRoom(app, alice, 'secret', 'private');
      const a = await connect(alice);
      const c = await connect(carol);

      const invite = await app.inject({
        method: 'POST',
        url: `/api/rooms/${privateId}/invite`,
        headers: authHeader(alice),
        payload: { userId: carol.id },
      });
      expect(invite.statusCode).toBe(204);
      await send(a, 'Добро пожаловать', privateId);
      const incoming = await c.next('new_message');
      expect(incoming.payload.message.content).toBe('Добро пожаловать');
    });
  });
});
