// Нагрузочный тест WebSocket: N одновременных подключений, пользователи сидят в комнатах
// по ROOM_SIZE человек и периодически пишут. Каждый получатель сравнивает время в тексте
// сообщения с текущим и так измеряет задержку доставки (все клиенты работают в одном
// процессе k6, часы общие).
//
// Подготовка:  node loadtest/seed.mjs http://localhost:8080 1000 10
// Запуск:      docker compose --profile loadtest run --rm k6 run /loadtest/ws-load.js
//              (или локально: k6 run -e WS_URL=ws://localhost:8080/ws loadtest/ws-load.js)
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));

const WS_URL = __ENV.WS_URL || 'ws://localhost:8080/ws';
const VUS = Number(__ENV.VUS || users.length);
const RAMP_SECONDS = Number(__ENV.RAMP_SECONDS || 30);
const HOLD_SECONDS = Number(__ENV.HOLD_SECONDS || 60);
const SEND_EVERY_MS = Number(__ENV.SEND_EVERY_MS || 5000);

const deliveryLatency = new Trend('delivery_latency_ms', true);
const ackLatency = new Trend('ack_latency_ms', true);
const sent = new Counter('messages_sent');
const delivered = new Counter('messages_delivered');
const errors = new Counter('chat_errors');

export const options = {
  scenarios: {
    chat: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: `${RAMP_SECONDS + HOLD_SECONDS + 60}s`,
    },
  },
  thresholds: {
    // Требование ТЗ: доставка получателю в пределах 200 мс при 1000 соединений
    delivery_latency_ms: ['p(95)<200'],
    ack_latency_ms: ['p(95)<200'],
    checks: ['rate>0.99'],
  },
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function () {
  const user = users[(__VU - 1) % users.length];
  // Подключения запускаются не разом, а равномерно в течение RAMP_SECONDS
  const startDelay = ((__VU - 1) * RAMP_SECONDS) / VUS;
  sleep(startDelay);
  const lifetimeMs = Math.max(5, RAMP_SECONDS + HOLD_SECONDS - startDelay) * 1000;
  const pending = {};

  const res = ws.connect(`${WS_URL}?token=${user.token}`, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join_room', payload: { roomId: user.roomId } }));

      socket.setTimeout(() => {
        socket.setInterval(() => {
          const clientMsgId = uuid();
          const now = Date.now();
          pending[clientMsgId] = now;
          socket.send(
            JSON.stringify({
              type: 'send_message',
              payload: { roomId: user.roomId, content: `lt:${now}:${__VU}`, clientMsgId },
            }),
          );
          sent.add(1);
        }, SEND_EVERY_MS);
      }, Math.random() * SEND_EVERY_MS + 1500);

      // Heartbeat, как у настоящего клиента
      socket.setInterval(() => socket.send(JSON.stringify({ type: 'ping', payload: {} })), 25000);
    });

    socket.on('message', (raw) => {
      const frame = JSON.parse(raw);
      if (frame.type === 'new_message') {
        const parts = String(frame.payload.message.content).split(':');
        if (parts[0] === 'lt') {
          deliveryLatency.add(Date.now() - Number(parts[1]));
          delivered.add(1);
        }
      } else if (frame.type === 'message_ack') {
        const t = pending[frame.payload.clientMsgId];
        if (t) {
          ackLatency.add(Date.now() - t);
          delete pending[frame.payload.clientMsgId];
        }
      } else if (frame.type === 'error') {
        errors.add(1);
      }
    });

    socket.on('error', () => errors.add(1));
    socket.setTimeout(() => socket.close(), lifetimeMs);
  });

  check(res, { 'WebSocket подключился (101)': (r) => r && r.status === 101 });
}
