import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/testEnv';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    // Тесты используют одну общую БД, поэтому файлы запускаются последовательно
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-for-vitest',
      LOG_LEVEL: 'silent',
      CORS_ORIGIN: 'http://localhost:8080',
    },
  },
});
