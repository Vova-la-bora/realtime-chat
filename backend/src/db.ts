import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// bigint (OID 20) приходит строкой, а все id в проекте помещаются в number
types.setTypeParser(20, (value) => parseInt(value, 10));
// То же для массивов bigint (OID 1016), например array_agg(user_id): разбираем как массив int4 (OID 1007)
type TypeOid = Parameters<typeof types.setTypeParser>[0];
types.setTypeParser(1016 as TypeOid, types.getTypeParser(1007 as TypeOid));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

// Выполняет функцию внутри транзакции
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
