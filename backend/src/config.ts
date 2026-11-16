import { randomUUID } from 'node:crypto';

// Настройки приложения берутся из переменных окружения
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:8080',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Имя инстанса: по нему инстансы отличают свои сообщения в Pub/Sub от чужих
  instanceId: process.env.INSTANCE_ID ?? randomUUID().slice(0, 8),
};
