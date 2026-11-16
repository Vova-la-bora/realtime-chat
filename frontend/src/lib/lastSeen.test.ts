import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LastSeenFormatter } from './lastSeen';

describe('LastSeenFormatter', () => {
  const formatter = new LastSeenFormatter();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('онлайн: «в сети», независимо от last_seen', () => {
    expect(formatter.format(true, null)).toBe('в сети');
    expect(formatter.format(true, new Date(2026, 5, 15, 9, 0).toISOString())).toBe('в сети');
  });

  it('офлайн без last_seen: «не в сети»', () => {
    expect(formatter.format(false, null)).toBe('не в сети');
  });

  it('сегодня: время, вчера: «вчера в …»', () => {
    expect(formatter.format(false, new Date(2026, 5, 15, 9, 5).toISOString())).toMatch(
      /^был\(а\) сегодня в \d{2}:\d{2}$/,
    );
    expect(formatter.format(false, new Date(2026, 5, 14, 23, 30).toISOString())).toMatch(
      /^был\(а\) вчера в \d{2}:\d{2}$/,
    );
  });

  it('раньше: только дата', () => {
    expect(formatter.format(false, new Date(2026, 5, 1, 10, 0).toISOString())).toMatch(
      /^был\(а\) \d{2}\.\d{2}$/,
    );
  });
});
