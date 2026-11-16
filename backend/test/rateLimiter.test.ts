import { beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/services/rateLimiter';
import { testRedis } from './helpers';
import type Redis from 'ioredis';

describe('RateLimiter: скользящее окно в Redis', () => {
  let limiter: RateLimiter;

  beforeEach(async () => {
    await testRedis.flushall();
    limiter = new RateLimiter(testRedis as unknown as Redis);
  });

  it('пропускает не больше limit событий за окно и отклоняет следующее', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await limiter.allow('rl:msg:1', 20, 10000, 1000 + i)).toBe(true);
    }
    expect(await limiter.allow('rl:msg:1', 20, 10000, 1100)).toBe(false);
  });

  it('снова разрешает события, когда старые выходят из окна', async () => {
    expect(await limiter.allow('k', 3, 1000, 0)).toBe(true);
    expect(await limiter.allow('k', 3, 1000, 100)).toBe(true);
    expect(await limiter.allow('k', 3, 1000, 200)).toBe(true);
    expect(await limiter.allow('k', 3, 1000, 300)).toBe(false);
    // Событие в момент 0 вышло из окна, освободилось одно место
    expect(await limiter.allow('k', 3, 1000, 1001)).toBe(true);
    expect(await limiter.allow('k', 3, 1000, 1002)).toBe(false);
  });

  it('отклонённые события не расходуют квоту', async () => {
    await limiter.allow('k', 2, 1000, 0);
    await limiter.allow('k', 2, 1000, 100);
    // Много отклонённых попыток подряд
    for (let t = 200; t < 700; t += 50) {
      expect(await limiter.allow('k', 2, 1000, t)).toBe(false);
    }
    // Как только вышло из окна первое событие, место освобождается ровно одно
    expect(await limiter.allow('k', 2, 1000, 1001)).toBe(true);
    expect(await limiter.allow('k', 2, 1000, 1002)).toBe(false);
  });

  it('счётчики разных ключей независимы', async () => {
    expect(await limiter.allow('a', 1, 1000, 0)).toBe(true);
    expect(await limiter.allow('a', 1, 1000, 1)).toBe(false);
    expect(await limiter.allow('b', 1, 1000, 1)).toBe(true);
  });

  it('при реальном времени ограничивает 20 событий за 10 секунд', async () => {
    let allowed = 0;
    for (let i = 0; i < 25; i += 1) {
      if (await limiter.allow('rl:msg:7', 20, 10000)) {
        allowed += 1;
      }
    }
    expect(allowed).toBe(20);
  });
});
