import { Pool } from 'pg';
import { UserRecord } from '../models';
import { escapeLike } from '../utils';
import { BaseRepository } from './baseRepository';

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  last_seen_at: Date | null;
  created_at: Date;
}

export class UserRepository extends BaseRepository<UserRecord> {
  constructor(pool: Pool) {
    super(pool, 'users');
  }

  mapRow(row: unknown): UserRecord {
    const r = row as UserRow;
    const user = new UserRecord();
    user.id = r.id;
    user.username = r.username;
    user.email = r.email;
    user.passwordHash = r.password_hash;
    user.displayName = r.display_name;
    user.avatarUrl = r.avatar_url;
    user.lastSeenAt = r.last_seen_at;
    user.createdAt = r.created_at;
    return user;
  }

  async findById(id: number): Promise<UserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  // Ищет пользователя по почте
  async getUserByMail(email: string): Promise<UserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  async create(
    username: string,
    email: string,
    passwordHash: string,
    displayName: string,
  ): Promise<UserRecord> {
    const res = await this.pool.query(
      'INSERT INTO users (username, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [username, email, passwordHash, displayName],
    );
    return this.mapRow(res.rows[0]);
  }

  async updateProfile(
    id: number,
    fields: { displayName?: string; avatarUrl?: string | null },
  ): Promise<UserRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.displayName !== undefined) {
      values.push(fields.displayName);
      sets.push(`display_name = $${values.length}`);
    }
    if (fields.avatarUrl !== undefined) {
      values.push(fields.avatarUrl);
      sets.push(`avatar_url = $${values.length}`);
    }
    if (sets.length === 0) {
      return this.findById(id);
    }
    values.push(id);
    const res = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return res.rows.length > 0 ? this.mapRow(res.rows[0]) : null;
  }

  // Запоминает время последнего посещения (вызывается, когда закрылось последнее подключение)
  async touchLastSeen(id: number): Promise<Date | null> {
    const res = await this.pool.query<{ last_seen_at: Date }>(
      'UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at',
      [id],
    );
    return res.rows.length > 0 ? res.rows[0].last_seen_at : null;
  }

  async search(query: string, excludeId: number, limit: number): Promise<UserRecord[]> {
    const pattern = `%${escapeLike(query)}%`;
    const res = await this.pool.query(
      'SELECT * FROM users WHERE id <> $1 AND (username ILIKE $2 OR display_name ILIKE $2) ORDER BY username LIMIT $3',
      [excludeId, pattern, limit],
    );
    return res.rows.map((row) => this.mapRow(row));
  }
}
