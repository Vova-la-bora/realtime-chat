import runner from 'node-pg-migrate';
import { TEST_DATABASE_URL } from './testEnv';

// Перед всеми тестами применяем миграции к тестовой БД
export default async function setup(): Promise<void> {
  await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}
