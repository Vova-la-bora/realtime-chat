import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

// Ограничение частоты через Redis: скользящее окно на отсортированном множестве
// (значение времени события -> уникальный элемент). Работает одинаково на всех инстансах.
export class RateLimiter {
  public redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // Возвращает true, если событие разрешено: за последние windowMs было не больше limit событий.
  // Отклонённое событие в лимит не засчитывается.
  async allow(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<boolean> {
    const member = `${now}:${randomUUID()}`;
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', now - windowMs)
      .zadd(key, now, member)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    if (count > limit) {
      await this.redis.zrem(key, member);
      return false;
    }
    return true;
  }
}
