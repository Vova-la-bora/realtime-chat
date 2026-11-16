import { Pool } from 'pg';
import { withTransaction } from '../db';
import { MemberRecord, RoomRecord } from '../models';
import { DialogKeys, escapeLike } from '../utils';
import { BaseRepository } from './baseRepository';

interface RoomRow {
  id: number;
  type: string;
  name: string | null;
  created_by: number | null;
  direct_key: string | null;
  created_at: Date;
}

interface MemberRow {
  room_id: number;
  user_id: number;
  role: string;
  last_read_message_id: number;
  joined_at: Date;
}

// Строка списка комнат пользователя
export interface RoomListRow {
  id: number;
  type: string;
  name: string | null;
  created_by: number | null;
  created_at: Date;
  role: string;
  last_read_message_id: number;
  last_message_id: number | null;
  last_content: string | null;
  last_sender_id: number | null;
  last_created_at: Date | null;
  last_deleted_at: Date | null;
  unread: number;
}

export interface PeerRow {
  room_id: number;
  id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface MemberInfoRow {
  user_id: number;
  last_read_message_id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  last_seen_at: Date | null;
  role: string;
  joined_at: Date;
}

export class RoomRepository extends BaseRepository<RoomRecord> {
  constructor(pool: Pool) {
    super(pool, 'rooms');
  }

  mapRow(row: unknown): RoomRecord {
    const r = row as RoomRow;
    const room = new RoomRecord();
    room.id = r.id;
    room.type = r.type;
    room.name = r.name;
    room.createdBy = r.created_by;
    room.directKey = r.direct_key;
    room.createdAt = r.created_at;
    return room;
  }

  async findById(id: number): Promise<RoomRecord | null> {
    const res = await this.pool.query('SELECT * FROM rooms WHERE id = $1', [id]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  async findByDirectKey(key: string): Promise<RoomRecord | null> {
    const res = await this.pool.query('SELECT * FROM rooms WHERE direct_key = $1', [key]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  // Создаёт группу и сразу делает автора владельцем
  async createGroup(type: string, name: string, createdBy: number): Promise<RoomRecord> {
    return withTransaction(async (client) => {
      const res = await client.query(
        'INSERT INTO rooms (type, name, created_by) VALUES ($1, $2, $3) RETURNING *',
        [type, name, createdBy],
      );
      const room = this.mapRow(res.rows[0]);
      await client.query(
        "INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')",
        [room.id, createdBy],
      );
      return room;
    });
  }

  // Создаёт личный диалог; при гонке возвращает уже созданный
  async createDirect(userId: number, peerId: number): Promise<RoomRecord> {
    const key = new DialogKeys().keyFor(userId, peerId);
    return withTransaction(async (client) => {
      const inserted = await client.query(
        "INSERT INTO rooms (type, created_by, direct_key) VALUES ('direct', $1, $2) ON CONFLICT (direct_key) DO NOTHING RETURNING *",
        [userId, key],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query('SELECT * FROM rooms WHERE direct_key = $1', [key]);
        return this.mapRow(existing.rows[0]);
      }
      const room = this.mapRow(inserted.rows[0]);
      await client.query(
        "INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
        [room.id, userId, peerId],
      );
      return room;
    });
  }

  async addMember(roomId: number, userId: number, role: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [roomId, userId, role],
    );
  }

  async getMember(roomId: number, userId: number): Promise<MemberRecord | null> {
    const res = await this.pool.query<MemberRow>(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId],
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    const member = new MemberRecord();
    member.roomId = row.room_id;
    member.userId = row.user_id;
    member.role = row.role;
    member.lastReadMessageId = row.last_read_message_id;
    member.joinedAt = row.joined_at;
    return member;
  }

  async removeMember(roomId: number, userId: number): Promise<void> {
    await this.pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [
      roomId,
      userId,
    ]);
  }

  async updateRole(roomId: number, userId: number, role: string): Promise<void> {
    await this.pool.query('UPDATE room_members SET role = $3 WHERE room_id = $1 AND user_id = $2', [
      roomId,
      userId,
      role,
    ]);
  }

  // Самый давний участник комнаты (кандидат в новые владельцы)
  async findEarliestMember(roomId: number): Promise<MemberRecord | null> {
    const res = await this.pool.query<MemberRow>(
      'SELECT * FROM room_members WHERE room_id = $1 ORDER BY joined_at, user_id LIMIT 1',
      [roomId],
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    const member = new MemberRecord();
    member.roomId = row.room_id;
    member.userId = row.user_id;
    member.role = row.role;
    member.lastReadMessageId = row.last_read_message_id;
    member.joinedAt = row.joined_at;
    return member;
  }

  async listMembers(roomId: number): Promise<MemberInfoRow[]> {
    const res = await this.pool.query<MemberInfoRow>(
      `SELECT m.user_id, m.last_read_message_id, u.username, u.display_name, u.avatar_url, u.last_seen_at, m.role, m.joined_at
       FROM room_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = $1
       ORDER BY m.joined_at, m.user_id`,
      [roomId],
    );
    return res.rows;
  }

  // Каталог публичных комнат от новых к старым (по id): на этом порядке держится курсор.
  // cursor это id последней показанной комнаты, вернутся комнаты с меньшим id
  async listPublic(query: string, cursor: number | null, limit: number): Promise<RoomRecord[]> {
    const params: unknown[] = [];
    let sql = "SELECT * FROM rooms WHERE type = 'public'";
    if (query !== '') {
      params.push(`%${escapeLike(query)}%`);
      sql += ` AND name ILIKE $${params.length}`;
    }
    if (cursor !== null) {
      params.push(cursor);
      sql += ` AND id < $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY id DESC LIMIT $${params.length}`;
    const res = await this.pool.query(sql, params);
    return res.rows.map((row) => this.mapRow(row));
  }

  // Комнаты пользователя с последним сообщением и счётчиком непрочитанных
  async listForUser(userId: number): Promise<RoomListRow[]> {
    const res = await this.pool.query<RoomListRow>(
      `SELECT r.id, r.type, r.name, r.created_by, r.created_at, m.role, m.last_read_message_id,
              lm.id AS last_message_id, lm.content AS last_content, lm.sender_id AS last_sender_id,
              lm.created_at AS last_created_at, lm.deleted_at AS last_deleted_at,
              (SELECT count(*)::int FROM messages um
                WHERE um.room_id = r.id AND um.id > m.last_read_message_id
                  AND um.sender_id <> $1 AND um.deleted_at IS NULL) AS unread
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
       LEFT JOIN LATERAL (
         SELECT id, content, sender_id, created_at, deleted_at
         FROM messages WHERE room_id = r.id ORDER BY id DESC LIMIT 1
       ) lm ON true
       WHERE m.user_id = $1
       ORDER BY COALESCE(lm.created_at, r.created_at) DESC, r.id DESC`,
      [userId],
    );
    return res.rows;
  }

  async listRoomIdsOfUser(userId: number): Promise<number[]> {
    const res = await this.pool.query<{ room_id: number }>(
      'SELECT room_id FROM room_members WHERE user_id = $1',
      [userId],
    );
    return res.rows.map((row) => row.room_id);
  }

  // Двигает отметку «прочитано» только вперёд. Возвращает новое значение или null, если оно не изменилось
  async markRead(roomId: number, userId: number, messageId: number): Promise<number | null> {
    const res = await this.pool.query<{ last_read_message_id: number }>(
      `UPDATE room_members SET last_read_message_id = $3
       WHERE room_id = $1 AND user_id = $2 AND last_read_message_id < $3
       RETURNING last_read_message_id`,
      [roomId, userId, messageId],
    );
    return res.rows.length > 0 ? res.rows[0].last_read_message_id : null;
  }

  // Собеседники по личным диалогам
  async listPeers(roomIds: number[], userId: number): Promise<PeerRow[]> {
    const res = await this.pool.query<PeerRow>(
      `SELECT m.room_id, u.id, u.username, u.display_name, u.avatar_url
       FROM room_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ANY($1::bigint[]) AND m.user_id <> $2`,
      [roomIds, userId],
    );
    return res.rows;
  }
}
