// Строка подключения к тестовой БД (создаётся скриптом db/init при первом старте postgres)
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://chat:chat_dev_password@localhost:5432/chat_test';
