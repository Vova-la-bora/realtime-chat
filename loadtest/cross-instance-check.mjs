// Проверка двух инстансов бэкенда на настоящем Redis: клиенты подключаются напрямую к api1 и api2
// и проверяют доставку событий между ними, статусы, подписки и общий лимит сообщений.
//
// Запуск после docker compose up -d:  node loadtest/cross-instance-check.mjs
//   (адреса инстансов: API1_URL, API2_URL; по умолчанию http://localhost:3000 и http://localhost:3001)
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Модуль ws берётся из зависимостей бэкенда (нужен npm install в backend)
const require = createRequire(fileURLToPath(new URL('../backend/package.json', import.meta.url)));
const WebSocket = require('ws');

const API1 = process.env.API1_URL ?? 'http://localhost:3000';
const API2 = process.env.API2_URL ?? 'http://localhost:3001';
const WS1 = API1.replace(/^http/, 'ws') + '/ws';
const WS2 = API2.replace(/^http/, 'ws') + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

async function api(base, path, body, token, method = 'POST') {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

class Client {
  constructor(url, token) {
    this.frames = [];
    this.waiters = [];
    this.ws = new WebSocket(`${url}?token=${token}`);
    this.ws.on('message', (raw) => {
      const f = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.type === f.type && (!w.pred || w.pred(f)));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(f); else this.frames.push(f);
    });
    this.opened = new Promise((r) => this.ws.on('open', r));
    this.closed = new Promise((r) => this.ws.on('close', (c) => r(c)));
  }
  send(type, payload = {}) { this.ws.send(JSON.stringify({ type, payload })); }
  next(type, pred, ms = 4000) {
    const i = this.frames.findIndex((f) => f.type === type && (!pred || pred(f)));
    if (i >= 0) return Promise.resolve(this.frames.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('нет кадра ' + type)), ms);
      this.waiters.push({ type, pred, resolve: (f) => { clearTimeout(t); resolve(f); } });
    });
  }
  count(type, pred) { return this.frames.filter((f) => f.type === type && (!pred || pred(f))).length; }
  async sync() { this.send('ping'); await this.next('pong'); }
  async join(roomId) { this.send('join_room', { roomId }); await this.sync(); }
  close() { this.ws.close(); }
}

const tag = Date.now().toString(36);
const pw = 'Cross-pw-7731';
const alice = (await api(API1, '/api/auth/register', { username: `xa${tag}`, email: `xa${tag}@x.test`, password: pw })).data;
const bob = (await api(API2, '/api/auth/register', { username: `xb${tag}`, email: `xb${tag}@x.test`, password: pw })).data;
const carol = (await api(API1, '/api/auth/register', { username: `xc${tag}`, email: `xc${tag}@x.test`, password: pw })).data;
check('токен, выданный api1, принимает api2', (await api(API2, '/api/users/me', null, alice.accessToken, 'GET')).status === 200);

const room = (await api(API1, '/api/rooms', { name: `cross-${tag}`, type: 'public' }, alice.accessToken)).data.room.id;
check('вход в комнату через api2 (комната создана на api1)', (await api(API2, `/api/rooms/${room}/join`, {}, bob.accessToken)).status === 200);

const a = new Client(WS1, alice.accessToken);
await a.opened;
await a.join(room);
// Боб подключается после того, как api1 подписался на канал комнаты
const b = new Client(WS2, bob.accessToken);
await b.opened;
await b.join(room);

// Присутствие: Боб подключился к api2, Алиса слушает на api1
const online = await a.next('presence_update', (f) => f.payload.userId === bob.user.id);
check('presence_update онлайн дошёл с api2 на api1', online.payload.online === true);

// Сообщение api1 -> api2 и обратно
const t0 = Date.now();
a.send('send_message', { roomId: room, content: 'привет из api1', clientMsgId: randomUUID() });
const ack = await a.next('message_ack');
const got = await b.next('new_message');
check('new_message: api1 -> api2', got.payload.message.content === 'привет из api1', `${Date.now() - t0} мс`);
check('автор получает ack и не получает собственное new_message', ack.payload.message.id === got.payload.message.id && a.count('new_message') === 0);
const t1 = Date.now();
b.send('send_message', { roomId: room, content: 'ответ из api2', clientMsgId: randomUUID() });
await b.next('message_ack');
const back = await a.next('new_message');
check('new_message: api2 -> api1', back.payload.message.content === 'ответ из api2', `${Date.now() - t1} мс`);

// Правка, печатает, прочитано, удаление
a.send('edit_message', { messageId: ack.payload.message.id, content: 'исправлено' });
check('message_edited доходит до api2', (await b.next('message_edited')).payload.message.content === 'исправлено');
b.send('typing', { roomId: room });
check('user_typing доходит до api1', (await a.next('user_typing')).payload.userId === bob.user.id);
b.send('mark_read', { roomId: room, messageId: ack.payload.message.id });
check('message_read доходит до api1', (await a.next('message_read')).payload.messageId === ack.payload.message.id);
a.send('delete_message', { messageId: ack.payload.message.id });
check('message_deleted доходит до api2', (await b.next('message_deleted')).payload.messageId === ack.payload.message.id);

// Идемпотентность между инстансами
const dup = randomUUID();
a.send('send_message', { roomId: room, content: 'один раз', clientMsgId: dup });
await a.next('message_ack');
const a2 = new Client(WS2, alice.accessToken); await a2.opened; await a2.join(room);
a2.send('send_message', { roomId: room, content: 'один раз', clientMsgId: dup });
await a2.next('message_ack');
const hist = (await api(API1, `/api/rooms/${room}/messages`, null, alice.accessToken, 'GET')).data.items;
check('повтор с тем же clientMsgId через другой инстанс не создаёт дубль', hist.filter((m) => m.clientMsgId === dup).length === 1);

// Membership: Боб выходит через REST на api1, его WebSocket держит api2
await api(API1, `/api/rooms/${room}/leave`, {}, bob.accessToken);
await sleep(500);
const before = b.count('new_message');
a.send('send_message', { roomId: room, content: 'Боб уже ушёл', clientMsgId: randomUUID() });
await a.next('message_ack');
await b.sync();
check('после выхода через REST на api1 Боб на api2 не получает события', b.count('new_message') === before);

// Приглашение через REST на api2, подключение Кэрол на api1
const priv = (await api(API1, '/api/rooms', { name: `secret-${tag}`, type: 'private' }, alice.accessToken)).data.room.id;
const c = new Client(WS1, carol.accessToken); await c.opened; await c.sync();
await api(API2, `/api/rooms/${priv}/invite`, { userId: carol.user.id }, alice.accessToken);
await sleep(500);
a2.send('send_message', { roomId: priv, content: 'добро пожаловать', clientMsgId: randomUUID() });
await a2.next('message_ack');
check('приглашённая через api2 Кэрол получает события на api1 без join_room', (await c.next('new_message')).payload.message.content === 'добро пожаловать');

// Онлайн-статус при подключениях на разных инстансах
await api(API2, `/api/rooms/${room}/join`, {}, bob.accessToken);
const b2 = new Client(WS1, bob.accessToken); await b2.opened; await b2.join(room);
await sleep(400);
b.close(); await b.closed; await sleep(600);
const members = (await api(API1, `/api/rooms/${room}/members`, null, alice.accessToken, 'GET')).data.items;
check('Боб онлайн, пока открыто подключение на api1 (закрыто на api2)', members.find((m) => m.userId === bob.user.id).online === true);
b2.close(); await b2.closed;
const off = await a.next('presence_update', (f) => f.payload.userId === bob.user.id && f.payload.online === false);
check('офлайн + last_seen после закрытия последнего подключения', !!off.payload.lastSeenAt);

// Rate limit общий для инстансов
const rl = [];
const cA = new Client(WS1, alice.accessToken), cB = new Client(WS2, alice.accessToken);
await Promise.all([cA.opened, cB.opened]);
for (let i = 0; i < 30; i++) {
  const cl = i % 2 === 0 ? cA : cB;
  cl.send('send_message', { roomId: room, content: `rl${i}`, clientMsgId: randomUUID() });
}
await sleep(2500);
const accepted = cA.count('message_ack') + cB.count('message_ack');
const limited = cA.count('error', (f) => f.payload.code === 'rate_limited') + cB.count('error', (f) => f.payload.code === 'rate_limited');
check('rate limit общий для двух инстансов (30 сообщений через api1 и api2 по очереди)', accepted + limited === 30 && limited >= 10 && accepted <= 20, `принято ${accepted}, отклонено ${limited}`);

for (const cl of [a, a2, c, cA, cB]) cl.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length - failed.length} из ${results.length} проверок прошли`);
process.exit(failed.length ? 1 : 0);
