import { Pool } from 'pg';

// Базовый репозиторий "на вырост": общие операции для всех таблиц
export abstract class BaseRepository<T> {
  public pool: Pool;
  protected tableName: string;

  constructor(pool: Pool, tableName: string) {
    this.pool = pool;
    this.tableName = tableName;
  }

  abstract mapRow(row: unknown): T;


  async findAll(limit = 100): Promise<T[]> {
    const res = await this.pool.query(`SELECT * FROM ${this.tableName} ORDER BY id LIMIT $1`, [
      limit,
    ]);
    return res.rows.map((row) => this.mapRow(row));
  }

  async count(): Promise<number> {
    const res = await this.pool.query(`SELECT count(*)::int AS cnt FROM ${this.tableName}`);
    return res.rows[0].cnt;
  }

  getPool(): Pool {
    return this.pool;
  }
}
