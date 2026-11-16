import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { createRoom, createTestApp, joinRoom, registerUser, resetDb, TestUser } from './helpers';
import { WsTestClient } from './wsClient';

describe('Ограничение частоты сообщений (20 за 10 секунд)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let alice: TestUser;
  let bob: TestUser;
  let roomId: number;
  const clients: WsTestClient[] = [];

  async function connect(user: TestUser): Promise<WsTestClient> {
    const client = await WsTestClient.connect(`${baseUrl}/ws?token=${user.accessToken}`);
    clients.push(client);
    return client;
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
    app.container.getRoomService().cache.clear();
    alice = await registerUser(app, 'alice');
    bob = await registerUser(app, 'bob');
    roomId = await createRoom(app, alice, 'general');
    await joinRoom(app, bob, roomId);
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.close();
    }
  });

  it('21-е сообщение подряд отклоняется ошибкой rate_limited и не сохраняется', async () => {
    const a = await connect(alice);
    for (let i = 0; i < 20; i += 1) {
      a.send('send_message', { roomId, content: `сообщение ${i}`, clientMsgId: randomUUID() });
      await a.next('message_ack');
    }

    const lastId = randomUUID();
    a.send('send_message', { roomId, content: 'лишнее', clientMsgId: lastId });
    const err = await a.next('error');
    expect(err.payload.code).toBe('rate_limited');
    expect(err.payload.refTo).toBe(lastId);

    const count = await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id = $1', [
      roomId,
    ]);
    expect(count.rows[0].n).toBe(20);
  });

  it('лимит считается на пользователя: общий для вкладок, не влияет на других', async () => {
    const tab1 = await connect(alice);
    const tab2 = await connect(alice);
    const b = await connect(bob);

    for (let i = 0; i < 10; i += 1) {
      tab1.send('send_message', { roomId, content: `a${i}`, clientMsgId: randomUUID() });
      await tab1.next('message_ack');
      tab2.send('send_message', { roomId, content: `b${i}`, clientMsgId: randomUUID() });
      await tab2.next('message_ack');
    }
    // Обе вкладки Алисы вместе исчерпали лимит
    tab2.send('send_message', { roomId, content: 'сверх лимита', clientMsgId: randomUUID() });
    expect((await tab2.next('error')).payload.code).toBe('rate_limited');

    // Боб не затронут
    b.send('send_message', { roomId, content: 'я могу', clientMsgId: randomUUID() });
    expect((await b.next('message_ack')).payload.message.content).toBe('я могу');
  });

  it('правка, «печатает…» и другие события лимитом на сообщения не ограничиваются', async () => {
    const a = await connect(alice);
    a.send('join_room', { roomId });
    await a.sync();
    a.send('send_message', { roomId, content: 'первое', clientMsgId: randomUUID() });
    const ack = await a.next('message_ack');
    for (let i = 0; i < 25; i += 1) {
      a.send('typing', { roomId });
    }
    a.send('edit_message', { messageId: ack.payload.message.id, content: 'правка' });
    expect((await a.next('message_edited')).payload.message.content).toBe('правка');
    await a.sync();
    expect(a.buffered('error')).toBe(0);
  });
});
