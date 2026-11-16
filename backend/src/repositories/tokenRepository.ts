import { Pool } from 'pg';

export class TokenRepository {
  public pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async save(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
  }

  // Ищет неотозванный и неистёкший токен
  async findActive(tokenHash: string): Promise<{ id: number; userId: number } | null> {
    const res = await this.pool.query(
      'SELECT id, user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
      [tokenHash],
    );
    if (res.rows.length === 0) {
      return null;
    }
    return { id: res.rows[0].id, userId: res.rows[0].user_id };
  }

  async revoke(id: number): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [id]);
  }

  async revokeByHash(tokenHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }
}
