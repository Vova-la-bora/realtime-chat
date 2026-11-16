import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './backoff';

describe('reconnectDelay', () => {
  it('растёт по степеням двойки: 1с, 2с, 4с, 8с (без джиттера, random = 1)', () => {
    const delays = [0, 1, 2, 3].map((attempt) => reconnectDelay(attempt, () => 1));
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('ограничена 30 секундами при любом числе попыток', () => {
    expect(reconnectDelay(5, () => 1)).toBe(30000);
    expect(reconnectDelay(50, () => 1)).toBe(30000);
    expect(reconnectDelay(1000, () => 1)).toBe(30000);
  });

  it('джиттер уменьшает задержку не более чем вдвое', () => {
    expect(reconnectDelay(2, () => 0)).toBe(2000);
    expect(reconnectDelay(2, () => 0.5)).toBe(3000);
  });

  it('с реальным random всегда укладывается в [база/2, база]', () => {
    for (let i = 0; i < 200; i += 1) {
      const delay = reconnectDelay(3);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });
});
