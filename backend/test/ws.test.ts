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

describe('WebSocket: обмен сообщениями', () => {
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

  async function countMessages(id: number): Promise<number> {
    const res = await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id = $1', [
      id,
    ]);
    return res.rows[0].n;
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

  it('закрывает подключение с кодом 4401, если токен невалидный', async () => {
    const client = await WsTestClient.connect(`${baseUrl}/ws?token=garbage`);
    expect(await client.closed).toBe(4401);
  });

  it('закрывает подключение с кодом 4401, если токена нет', async () => {
    const client = await WsTestClient.connect(`${baseUrl}/ws`);
    expect(await client.closed).toBe(4401);
  });

  it('отвечает pong на ping', async () => {
    const client = await connect(alice);
    client.send('ping');
    const frame = await client.next('pong');
    expect(frame.payload).toEqual({});
  });

  it('два клиента обмениваются сообщениями в реальном времени', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    const clientMsgId = randomUUID();
    a.send('send_message', { roomId, content: 'Привет, Боб!', clientMsgId });

    const ack = await a.next('message_ack');
    expect(ack.payload.clientMsgId).toBe(clientMsgId);
    expect(ack.payload.message.content).toBe('Привет, Боб!');
    expect(ack.payload.message.senderId).toBe(alice.id);

    const incoming = await b.next('new_message');
    expect(incoming.payload.message.id).toBe(ack.payload.message.id);
    expect(incoming.payload.message.content).toBe('Привет, Боб!');

    // Отправитель получает только ack, а не собственное new_message
    await a.sync();
    expect(a.buffered('new_message')).toBe(0);

    // Ответ в обратную сторону
    b.send('send_message', { roomId, content: 'Привет, Алиса!', clientMsgId: randomUUID() });
    const reply = await a.next('new_message');
    expect(reply.payload.message.content).toBe('Привет, Алиса!');

    // Сообщения попали в историю
    const history = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      headers: authHeader(bob),
    });
    expect(history.json().items.map((m: { content: string }) => m.content)).toEqual([
      'Привет, Алиса!',
      'Привет, Боб!',
    ]);
  });

  it('повторная отправка с тем же clientMsgId не создаёт дубль и не рассылается заново', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    const clientMsgId = randomUUID();
    const payload = { roomId, content: 'Один раз', clientMsgId };
    a.send('send_message', payload);
    const first = await a.next('message_ack');
    a.send('send_message', payload);
    const second = await a.next('message_ack');

    expect(second.payload.message.id).toBe(first.payload.message.id);
    expect(await countMessages(roomId)).toBe(1);

    await b.sync();
    expect(b.buffered('new_message')).toBe(1);
  });

  it('другие вкладки отправителя тоже получают new_message', async () => {
    const tab1 = await connect(alice);
    const tab2 = await connect(alice);
    await joinWs(tab1, roomId);
    await joinWs(tab2, roomId);

    tab1.send('send_message', { roomId, content: 'С первой вкладки', clientMsgId: randomUUID() });
    await tab1.next('message_ack');
    const onSecondTab = await tab2.next('new_message');
    expect(onSecondTab.payload.message.content).toBe('С первой вкладки');
  });

  it('не пускает в чужую комнату: join_room возвращает not_a_member', async () => {
    const c = await connect(carol);
    c.send('join_room', { roomId });
    const err = await c.next('error');
    expect(err.payload.code).toBe('not_a_member');
  });

  it('не принимает сообщения от не-участника и ничего не сохраняет', async () => {
    const a = await connect(alice);
    const c = await connect(carol);
    await joinWs(a, roomId);

    const clientMsgId = randomUUID();
    c.send('send_message', { roomId, content: 'Я сюда не вхожу', clientMsgId });
    const err = await c.next('error');
    expect(err.payload.code).toBe('not_a_member');
    expect(err.payload.refTo).toBe(clientMsgId);

    await a.sync();
    expect(a.buffered('new_message')).toBe(0);
    expect(await countMessages(roomId)).toBe(0);
  });

  it('после выхода из комнаты через REST пользователь перестаёт получать сообщения', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);

    await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/leave`,
      headers: authHeader(bob),
    });

    a.send('send_message', { roomId, content: 'Боб уже ушёл', clientMsgId: randomUUID() });
    await a.next('message_ack');
    await b.sync();
    expect(b.buffered('new_message')).toBe(0);
  });

  it('после leave_room подключение не получает события комнаты', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    await joinWs(a, roomId);
    await joinWs(b, roomId);
    b.send('leave_room', { roomId });
    await b.sync();

    a.send('send_message', { roomId, content: 'Тишина', clientMsgId: randomUUID() });
    await a.next('message_ack');
    await b.sync();
    expect(b.buffered('new_message')).toBe(0);
  });

  it('валидирует входящие данные и сообщает об ошибках событием error', async () => {
    const a = await connect(alice);

    a.send('send_message', { roomId, content: '', clientMsgId: randomUUID() });
    expect((await a.next('error')).payload.code).toBe('validation_error');

    a.send('send_message', { roomId, content: 'текст', clientMsgId: 'not-a-uuid' });
    expect((await a.next('error')).payload.code).toBe('validation_error');

    a.send('send_message', { roomId, content: 'x'.repeat(4001), clientMsgId: randomUUID() });
    expect((await a.next('error')).payload.code).toBe('validation_error');

    a.send('no_such_event', {});
    expect((await a.next('error')).payload.code).toBe('unknown_type');

    a.sendRaw('это не JSON');
    expect((await a.next('error')).payload.code).toBe('invalid_json');

    a.sendRaw(JSON.stringify([1, 2, 3]));
    expect((await a.next('error')).payload.code).toBe('invalid_frame');

    expect(await countMessages(roomId)).toBe(0);
  });

  it('закрывает подключение, если кадр больше 16 КБ', async () => {
    const a = await connect(alice);
    a.sendRaw(JSON.stringify({ type: 'ping', payload: { junk: 'x'.repeat(20 * 1024) } }));
    expect(await a.closed).toBe(1009);
  });
});
