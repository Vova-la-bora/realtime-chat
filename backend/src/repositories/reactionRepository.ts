import { Pool } from 'pg';

// Реакции одного вида под сообщением: сколько их и кто поставил
export interface ReactionJson {
  emoji: string;
  count: number;
  userIds: number[];
}

interface ReactionRow {
  message_id: number;
  emoji: string;
  user_ids: number[];
}

export class ReactionRepository {
  public pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Переключает реакцию пользователя: если её не было, ставит, если была, снимает.
  // Одним запросом, поэтому два одновременных клика не расходятся. Возвращает true, если поставлена.
  async toggle(messageId: number, userId: number, emoji: string): Promise<boolean> {
    const res = await this.pool.query(
      `WITH removed AS (
         DELETE FROM message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3
         RETURNING 1
       )
       INSERT INTO message_reactions (message_id, user_id, emoji)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM removed)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [messageId, userId, emoji],
    );
    return res.rows.length > 0;
  }

  // Реакции сразу для нескольких сообщений: message_id -> список по видам эмодзи
  async listForMessages(messageIds: number[]): Promise<Map<number, ReactionJson[]>> {
    const map = new Map<number, ReactionJson[]>();
    if (messageIds.length === 0) {
      return map;
    }
    const res = await this.pool.query<ReactionRow>(
      `SELECT message_id, emoji, array_agg(user_id ORDER BY created_at, user_id) AS user_ids
       FROM message_reactions
       WHERE message_id = ANY($1::bigint[])
       GROUP BY message_id, emoji
       ORDER BY message_id, min(created_at), emoji`,
      [messageIds],
    );
    for (const row of res.rows) {
      const list = map.get(row.message_id) ?? [];
      list.push({ emoji: row.emoji, count: row.user_ids.length, userIds: row.user_ids });
      map.set(row.message_id, list);
    }
    return map;
  }
}
