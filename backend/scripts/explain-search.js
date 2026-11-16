// Проверка скорости полнотекстового поиска по сообщениям комнаты на большой таблице.
// Заполняет таблицу сообщениями со словарём из десяти слов и печатает EXPLAIN ANALYZE
// для запросов, которые выполняет MessageRepository.search.
//
// Использование: DATABASE_URL=postgres://... node scripts/explain-search.js [ROWS] [ROOMS]
//   ROWS   сколько сообщений создать (по умолчанию 1 000 000)
//   ROOMS  по скольким комнатам их распределить (по умолчанию 100)
// Миграции в базе должны быть применены (npm run migrate:up).
const { Pool } = require('pg');

const rows = Number(process.argv[2] ?? 1000000);
const rooms = Number(process.argv[3] ?? 100);

const COLUMNS = 'id, room_id, sender_id, client_msg_id, content, created_at, edited_at, deleted_at';
const SEARCH_SQL = `SELECT ${COLUMNS} FROM messages
  WHERE room_id = $1 AND deleted_at IS NULL AND search_vector @@ websearch_to_tsquery('russian', $2)`;

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

  console.log(
    `Создаём ${rows} сообщений в ${rooms} комнатах (индекс поиска строится вместе со вставкой) ...`,
  );
  const started = Date.now();
  await pool.query(
    `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
     SELECT $1::bigint + (g % $3::int), $2, gen_random_uuid(),
            (ARRAY['релиз','архитектура','сервер','деплой','ошибка','тест','ревью','задача','спринт','встреча'])[1 + (g / $3::int) % 10]
            || ' ' ||
            (ARRAY['проекта','сервиса','клиента','команды','модуля','отчёта','базы','очереди','фронтенда','бэкенда'])[1 + (g / ($3::int * 10)) % 10]
            || ' номер ' || g
     FROM generate_series(1, $4::int) g`,
    [roomIds[0], userId, rooms, rows],
  );
  console.log(
    `Готово за ${Math.round((Date.now() - started) / 1000)} с, выполняем VACUUM ANALYZE ...`,
  );
  await pool.query('VACUUM ANALYZE messages');

  const total = (await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n;
  const inRoom = (
    await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id = $1', [target])
  ).rows[0].n;
  const version = (await pool.query('SHOW server_version')).rows[0].server_version;
  const sizes = (
    await pool.query(
      "SELECT pg_size_pretty(pg_relation_size('messages')) AS tbl, pg_size_pretty(pg_relation_size('messages_room_search_idx')) AS idx",
    )
  ).rows[0];
  console.log(`PostgreSQL ${version}; всего сообщений: ${total}; в комнате ${target}: ${inRoom}`);
  console.log(
    `Размер таблицы: ${sizes.tbl}; размер индекса поиска (room_id + search_vector): ${sizes.idx}`,
  );

  const hits = async (q) =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM messages WHERE room_id = $1 AND search_vector @@ websearch_to_tsquery('russian', $2)`,
        [target, q],
      )
    ).rows[0].n;
  const midId = async (q) =>
    (
      await pool.query(
        `SELECT id FROM messages WHERE room_id = $1 AND search_vector @@ websearch_to_tsquery('russian', $2) ORDER BY id OFFSET $3 LIMIT 1`,
        [target, q, Math.floor((await hits(q)) / 2)],
      )
    ).rows[0].id;

  const frequent = 'релиз';
  const narrow = 'релиз проекта';
  const cases = [
    {
      name: `частое слово «${frequent}», первая страница`,
      sql: `${SEARCH_SQL} ORDER BY id DESC LIMIT 21`,
      params: [target, frequent],
      q: frequent,
    },
    {
      name: `частое слово «${frequent}», страница из середины (before_id)`,
      sql: `${SEARCH_SQL} AND id < $3 ORDER BY id DESC LIMIT 21`,
      params: [target, frequent, await midId(frequent)],
      q: frequent,
    },
    {
      name: `два слова «${narrow}»`,
      sql: `${SEARCH_SQL} ORDER BY id DESC LIMIT 21`,
      params: [target, narrow],
      q: narrow,
    },
    {
      name: 'слово, которого нет в сообщениях',
      sql: `${SEARCH_SQL} ORDER BY id DESC LIMIT 21`,
      params: [target, 'несуществующее'],
      q: 'несуществующее',
    },
  ];
  for (const c of cases) {
    const times = [];
    let plan = [];
    for (let i = 0; i < 9; i += 1) {
      plan = await explain(pool, c.sql, c.params);
      times.push(executionTime(plan));
    }
    const s = stats(times);
    console.log(`\n=== ${c.name} (подходящих сообщений в комнате: ${await hits(c.q)}) ===`);
    console.log(plan.join('\n'));
    console.log(
      `Время выполнения за 9 запусков, мс: min ${s.min}, median ${s.median}, max ${s.max}`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
