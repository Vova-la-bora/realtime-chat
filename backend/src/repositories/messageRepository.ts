import { Pool } from 'pg';
import { MessageRecord } from '../models';

interface MessageRow {
  id: number;
  room_id: number;
  sender_id: number;
  client_msg_id: string;
  content: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

// Столбцы перечислены явно: у таблицы есть служебный столбец search_vector,
// который не нужно вытаскивать из БД вместе с каждым сообщением
const COLUMNS = 'id, room_id, sender_id, client_msg_id, content, created_at, edited_at, deleted_at';

export class MessageRepository {
  public pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  mapRow(row: MessageRow): MessageRecord {
    const m = new MessageRecord();
    m.id = row.id;
    m.roomId = row.room_id;
    m.senderId = row.sender_id;
    m.clientMsgId = row.client_msg_id;
    m.content = row.content;
    m.createdAt = row.created_at;
    m.editedAt = row.edited_at;
    m.deletedAt = row.deleted_at;
    return m;
  }

  // Сохраняет сообщение. Повторная отправка с тем же clientMsgId не создаёт дубль:
  // возвращается уже сохранённое сообщение и duplicate = true
  async insertIdempotent(
    roomId: number,
    senderId: number,
    content: string,
    clientMsgId: string,
  ): Promise<{ message: MessageRecord; duplicate: boolean }> {
    const inserted = await this.pool.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, client_msg_id, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sender_id, client_msg_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [roomId, senderId, clientMsgId, content],
    );
    if (inserted.rows.length > 0) {
      return { message: this.mapRow(inserted.rows[0]), duplicate: false };
    }
    const existing = await this.pool.query<MessageRow>(
      `SELECT ${COLUMNS} FROM messages WHERE sender_id = $1 AND client_msg_id = $2`,
      [senderId, clientMsgId],
    );
    return { message: this.mapRow(existing.rows[0]), duplicate: true };
  }

  async findById(id: number): Promise<MessageRecord | null> {
    const res = await this.pool.query<MessageRow>(`SELECT ${COLUMNS} FROM messages WHERE id = $1`, [
      id,
    ]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  async existsInRoom(messageId: number, roomId: number): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 FROM messages WHERE id = $1 AND room_id = $2', [
      messageId,
      roomId,
    ]);
    return res.rows.length > 0;
  }

  // Меняет текст неудалённого сообщения и ставит отметку «изменено»
  async updateContent(id: number, content: string): Promise<MessageRecord | null> {
    const res = await this.pool.query<MessageRow>(
      `UPDATE messages SET content = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
      [id, content],
    );
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  // Мягкое удаление: текст остаётся в БД, клиентам отдаётся заглушка
  async softDelete(id: number): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE messages SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Страница истории: сообщения старше beforeId, от новых к старым (без OFFSET)
  // options задел под фильтрацию удалённых сообщений, пока не используется
  async history(
    roomId: number,
    beforeId: number | null,
    limit: number,
    options?: { includeDeleted?: boolean; strict?: boolean },
  ): Promise<MessageRecord[]> {
    if (beforeId === null) {
      const res = await this.pool.query<MessageRow>(
        `SELECT ${COLUMNS} FROM messages WHERE room_id = $1 ORDER BY id DESC LIMIT $2`,
        [roomId, limit],
      );
      return res.rows.map((row) => this.mapRow(row));
    }
    const res = await this.pool.query<MessageRow>(
      `SELECT ${COLUMNS} FROM messages WHERE room_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`,
      [roomId, beforeId, limit],
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  // Полнотекстовый поиск в комнате (PostgreSQL full-text search по индексу search_vector).
  // Удалённые сообщения не ищутся, результаты идут от новых к старым с курсором beforeId.
  async search(
    roomId: number,
    query: string,
    beforeId: number | null,
    limit: number,
  ): Promise<MessageRecord[]> {
    const params: unknown[] = [roomId, query];
    let sql = `SELECT ${COLUMNS} FROM messages
               WHERE room_id = $1 AND deleted_at IS NULL
                 AND search_vector @@ websearch_to_tsquery('russian', $2)`;
    if (beforeId !== null) {
      params.push(beforeId);
      sql += ` AND id < $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY id DESC LIMIT $${params.length}`;
    const res = await this.pool.query<MessageRow>(sql, params);
    return res.rows.map((row) => this.mapRow(row));
  }
}
