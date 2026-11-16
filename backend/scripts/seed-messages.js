// Создаёт N тестовых сообщений в комнате (для проверки пагинации истории).
// Использование: node scripts/seed-messages.js <roomId> <senderId> <count>
const { Pool } = require('pg');

async function main() {
  const [roomId, senderId, count] = process.argv.slice(2).map(Number);
  if (!roomId || !senderId || !count) {
    console.error('Использование: node scripts/seed-messages.js <roomId> <senderId> <count>');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
     SELECT $1, $2, gen_random_uuid(), 'Тестовое сообщение #' || g
     FROM generate_series(1, $3::int) AS g`,
    [roomId, senderId, count],
  );
  console.log(`Добавлено сообщений: ${count} (комната ${roomId}, автор ${senderId})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
