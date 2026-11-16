// Готовит данные для нагрузочного теста: регистрирует пользователей, раскладывает их по
// публичным комнатам и сохраняет токены в loadtest/users.json (читает k6).
//
// Использование: node loadtest/seed.mjs [BASE_URL] [USERS] [ROOM_SIZE]
//   BASE_URL   адрес сайта (Nginx), по умолчанию http://localhost:8080
//   USERS      сколько пользователей (по умолчанию 1000)
//   ROOM_SIZE  сколько пользователей в одной комнате (по умолчанию 10)
//
// Access-токен живёт 15 минут, поэтому запускайте тест сразу после этого скрипта.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8080';
const total = Number(process.argv[3] ?? process.env.USERS ?? 1000);
const roomSize = Number(process.argv[4] ?? process.env.ROOM_SIZE ?? 10);
const password = 'LoadTest-pw-1';
const runId = Date.now().toString(36);

async function api(path, body, token) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return data;
}

// Выполняет задачи с ограничением параллелизма
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

const started = Date.now();
console.log(`Регистрируем ${total} пользователей на ${base} ...`);
const users = await runPool([...Array(total).keys()], 20, async (i) => {
  const username = `lt${runId}_${i}`;
  const res = await api('/api/auth/register', {
    username,
    email: `${username}@load.test`,
    password,
  });
  return { userId: res.user.id, username, token: res.accessToken, roomId: 0 };
});

console.log('Создаём комнаты и добавляем участников ...');
const groups = [];
for (let i = 0; i < users.length; i += roomSize) {
  groups.push(users.slice(i, i + roomSize));
}
await runPool(groups, 20, async (group, index) => {
  const owner = group[0];
  const created = await api(
    '/api/rooms',
    { name: `load-${runId}-${index}`, type: 'public' },
    owner.token,
  );
  const roomId = created.room.id;
  owner.roomId = roomId;
  for (const member of group.slice(1)) {
    await api(`/api/rooms/${roomId}/join`, {}, member.token);
    member.roomId = roomId;
  }
});

const file = join(dirname(fileURLToPath(import.meta.url)), 'users.json');
writeFileSync(file, JSON.stringify(users));
console.log(
  `Готово: ${users.length} пользователей, ${groups.length} комнат, ${Math.round((Date.now() - started) / 1000)} с. Файл: ${file}`,
);
