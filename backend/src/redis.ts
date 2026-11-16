import Redis from 'ioredis';
import { config } from './config';

// Подключение к Redis: онлайн-статусы (этап 4), Pub/Sub и rate limiting (этап 5)
export function createRedis(url: string = config.redisUrl): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2 });
}
