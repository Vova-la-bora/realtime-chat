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
  sleep,
  TestUser,
} from './helpers';
import { WsTestClient } from './wsClient';

// Два инстанса бэкенда в одном процессе: у каждого свои подключения WebSocket и своя шина,
// а БД и Redis общие. Это то, как работает развёртывание за балансировщиком.
describe('Несколько инстансов бэкенда', () => {
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let urlA: string;
  let urlB: string;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let roomId: number;
  const clients: WsTestClient[] = [];

  async function connect(base: string, user: TestUser): Promise<WsTestClient> {
    const client = await WsTestClient.connect(`${base}/ws?token=${user.accessToken}`);
    clients.push(client);
    return client;
  }

  async function joinWs(client: WsTestClient, id: number): Promise<void> {
    client.send('join_room', { roomId: id });
    await client.sync();
  }

  async function send(client: WsTestClient, text: string, id = roomId): Promise<number> {
    client.send('send_message', { roomId: id, content: text, clientMsgId: randomUUID() });
    const ack = await client.next('message_ack');
    return ack.payload.message.id;
  }

  async function address(app: FastifyInstance): Promise<string> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    return `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    appA = await createTestApp({ instanceId: 'inst-a', ownRedis: true });
    appB = await createTestApp({ instanceId: 'inst-b', ownRedis: true });
    urlA = await address(appA);
    urlB = await address(appB);
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
  });

  beforeEach(async () => {
    await resetDb();
    appA.container.getRoomService().cache.clear();
    appB.container.getRoomService().cache.clear();
    // Регистрация и создание комнаты на A, вход в комнату через B: токены и данные общие
    alice = await registerUser(appA, 'alice');
    bob = await registerUser(appA, 'bob');
    carol = await registerUser(appA, 'carol');
    roomId = await createRoom(appA, alice, 'general');
    await joinRoom(appB, bob, roomId);
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.close();
    }
  });

  it('инстансы отвечают под своими именами', async () => {
    const a = await appA.inject({ method: 'GET', url: '/health' });
    const b = await appB.inject({ method: 'GET', url: '/health' });
    expect(a.json()).toEqual({ status: 'ok', instance: 'inst-a' });
    expect(b.json()).toEqual({ status: 'ok', instance: 'inst-b' });
  });

  it('сообщение доходит между пользователями на разных инстансах', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlB, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    const id = await send(a, 'Привет с инстанса A');
    const incoming = await b.next('new_message');
    expect(incoming.payload.message).toMatchObject({ id, content: 'Привет с инстанса A' });

    const reply = await send(b, 'Ответ с инстанса B');
    const back = await a.next('new_message');
    expect(back.payload.message).toMatchObject({ id: reply, content: 'Ответ с инстанса B' });
  });

  it('автору приходит только ack, а его вторая вкладка на другом инстансе получает new_message', async () => {
    const tabA = await connect(urlA, alice);
    const tabB = await connect(urlB, alice);
    await joinWs(tabA, roomId);
    await joinWs(tabB, roomId);

    await send(tabA, 'Сообщение с первой вкладки');
    const mirrored = await tabB.next('new_message');
    expect(mirrored.payload.message.content).toBe('Сообщение с первой вкладки');
    await tabA.sync();
    expect(tabA.buffered('new_message')).toBe(0);
  });

  it('правка, удаление, «печатает…» и «прочитано» тоже пересекают инстансы', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlB, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    const id = await send(a, 'Опечатка');
    await b.next('new_message');

    a.send('edit_message', { messageId: id, content: 'Исправлено' });
    expect((await b.next('message_edited')).payload.message.content).toBe('Исправлено');
    await a.next('message_edited');

    b.send('typing', { roomId });
    expect((await a.next('user_typing')).payload).toEqual({ roomId, userId: bob.id });

    b.send('mark_read', { roomId, messageId: id });
    expect((await a.next('message_read')).payload).toEqual({
      roomId,
      userId: bob.id,
      messageId: id,
    });

    a.send('delete_message', { messageId: id });
    expect((await b.next('message_deleted')).payload).toEqual({ roomId, messageId: id });
  });

  it('онлайн-статус общий: пользователь офлайн, только когда закрылось его последнее подключение на любом инстансе', async () => {
    const a = await connect(urlA, alice);
    await joinWs(a, roomId);

    const onB = await connect(urlB, bob);
    const online = await a.next('presence_update', 3000, (f) => f.payload.userId === bob.id);
    expect(online.payload.online).toBe(true);

    const onA = await connect(urlA, bob);
    await sleep(300);
    await a.sync();
    expect(a.buffered('presence_update', (f) => f.payload.userId === bob.id)).toBe(0);

    onB.close();
    await sleep(400);
    await a.sync();
    expect(a.buffered('presence_update', (f) => f.payload.userId === bob.id)).toBe(0);
    const stillOnline = await appB.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: authHeader(alice),
    });
    expect(
      stillOnline.json().items.find((m: { userId: number }) => m.userId === bob.id).online,
    ).toBe(true);

    onA.close();
    const offline = await a.next(
      'presence_update',
      3000,
      (f) => f.payload.userId === bob.id && f.payload.online === false,
    );
    expect(offline.payload.lastSeenAt).toBeTruthy();
  });

  it('подключение в нескольких общих комнатах получает статус один раз', async () => {
    const second = await createRoom(appA, alice, 'second');
    await joinRoom(appB, bob, second);
    const a = await connect(urlA, alice);
    await joinWs(a, roomId);
    await joinWs(a, second);

    await connect(urlB, bob);
    await a.next('presence_update', 3000, (f) => f.payload.userId === bob.id);
    await sleep(400);
    await a.sync();
    expect(a.buffered('presence_update', (f) => f.payload.userId === bob.id)).toBe(0);
  });

  it('выход из комнаты через REST на одном инстансе отписывает подключения на другом', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlB, bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    await appA.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/leave`,
      headers: authHeader(bob),
    });
    await sleep(300);

    await send(a, 'Боб уже ушёл');
    await b.sync();
    expect(b.buffered('new_message')).toBe(0);
  });

  it('приглашение через REST на одном инстансе подписывает подключения на другом', async () => {
    const privateId = await createRoom(appA, alice, 'secret', 'private');
    const a = await connect(urlA, alice);
    const c = await connect(urlB, carol);

    const res = await appA.inject({
      method: 'POST',
      url: `/api/rooms/${privateId}/invite`,
      headers: authHeader(alice),
      payload: { userId: carol.id },
    });
    expect(res.statusCode).toBe(204);
    await sleep(300);

    await send(a, 'Добро пожаловать', privateId);
    expect((await c.next('new_message')).payload.message.content).toBe('Добро пожаловать');
  });

  it('инстанс подписан на канал комнаты, только пока в ней есть его подключения', async () => {
    const busA = appA.container.getBus();
    const busB = appB.container.getBus();
    expect(busB.activeRooms()).not.toContain(roomId);

    const b = await connect(urlB, bob);
    await joinWs(b, roomId);
    expect(busB.activeRooms()).toContain(roomId);
    expect(busA.activeRooms()).not.toContain(roomId);

    const a = await connect(urlA, alice);
    await joinWs(a, roomId);
    expect(busA.activeRooms()).toContain(roomId);

    b.send('leave_room', { roomId });
    await b.sync();
    expect(busB.activeRooms()).not.toContain(roomId);
    // Автор на A по-прежнему получает свои события, а B их больше не слушает
    await send(a, 'Никто не слушает на B');
    await b.sync();
    expect(b.buffered('new_message')).toBe(0);
  });

  it('сообщения сохраняются один раз и идемпотентны между инстансами', async () => {
    const a = await connect(urlA, alice);
    const b = await connect(urlB, alice);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    const clientMsgId = randomUUID();
    const payload = { roomId, content: 'Один раз', clientMsgId };
    a.send('send_message', payload);
    await a.next('message_ack');
    // Повтор с тем же clientMsgId, но через другой инстанс
    b.send('send_message', payload);
    const second = await b.next('message_ack');
    expect(second.payload.clientMsgId).toBe(clientMsgId);

    const count = await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id = $1', [
      roomId,
    ]);
    expect(count.rows[0].n).toBe(1);
  });
});
