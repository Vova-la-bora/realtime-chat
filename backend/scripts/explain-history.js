// Проверка требования «страница истории (50 сообщений) не более 50 мс на таблице в 1 млн
// сообщений при наличии индекса». Заполняет таблицу и печатает EXPLAIN ANALYZE.
//
// Использование: DATABASE_URL=postgres://... node scripts/explain-history.js [ROWS] [ROOMS]
//   ROWS   сколько сообщений создать (по умолчанию 1 000 000)
//   ROOMS  по скольким комнатам их распределить (по умолчанию 100)
const { Pool } = require('pg');

const rows = Number(process.argv[2] ?? 1000000);
const rooms = Number(process.argv[3] ?? 100);

function executionTime(plan) {
  const line = plan.find((l) => l.startsWith('Execution Time'));
  return line ? parseFloat(line.replace(/[^0-9.]/g, '')) : NaN;
}

async function explain(pool, sql, params) {
  const res = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
  return res.rows.map((r) => r['QUERY PLAN']);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tag = Date.now().toString(36);

  const user = await pool.query(
    "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id",
    [`bench_${tag}`, `bench_${tag}@bench.test`],
  );
  const userId = user.rows[0].id;
  const created = await pool.query(
    "INSERT INTO rooms (type, name, created_by) SELECT 'public', 'bench-' || g, $1 FROM generate_series(1, $2::int) g RETURNING id",
    [userId, rooms],
  );
  const roomIds = created.rows.map((r) => r.id).sort((a, b) => a - b);
  const target = roomIds[0];

  console.log(`Создаём ${rows} сообщений в ${rooms} комнатах ...`);
  const started = Date.now();
  await pool.query(
    `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
     SELECT $1::bigint + (g % $3::int), $2, gen_random_uuid(), 'Сообщение номер ' || g
     FROM generate_series(1, $4::int) g`,
    [roomIds[0], userId, rooms, rows],
  );
  console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с, выполняем VACUUM ANALYZE ...`);
  await pool.query('VACUUM ANALYZE messages');

  const total = (await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n;
  const inRoom = (await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id = $1', [target])).rows[0].n;
  const version = (await pool.query('SHOW server_version')).rows[0].server_version;
  console.log(`PostgreSQL ${version}; всего сообщений: ${total}; в комнате ${target}: ${inRoom}`);

  const firstPage = 'SELECT * FROM messages WHERE room_id = $1 ORDER BY id DESC LIMIT 51';
  const midId = (
    await pool.query('SELECT id FROM messages WHERE room_id = $1 ORDER BY id OFFSET $2 LIMIT 1', [target, Math.floor(inRoom / 2)])
  ).rows[0].id;
  const deepPage = 'SELECT * FROM messages WHERE room_id = $1 AND id < $2 ORDER BY id DESC LIMIT 51';

  const cases = [
    { name: 'первая страница (самые новые 50)', sql: firstPage, params: [target] },
    { name: 'страница из середины истории (before_id)', sql: deepPage, params: [target, midId] },
  ];
  for (const c of cases) {
    const times = [];
    let plan = [];
    for (let i = 0; i < 9; i += 1) {
      plan = await explain(pool, c.sql, c.params);
      times.push(executionTime(plan));
    }
    const s = stats(times);
    console.log(`\n=== ${c.name} ===`);
    console.log(plan.join('\n'));
    console.log(`Время выполнения за 9 запусков, мс: min ${s.min}, median ${s.median}, max ${s.max}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
