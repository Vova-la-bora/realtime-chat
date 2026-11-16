import { describe, expect, it } from 'vitest';
import { toMessage, toReaction } from './mappers';

const base = {
  id: 5,
  roomId: 1,
  senderId: 2,
  clientMsgId: 'c1',
  content: 'привет',
  createdAt: '2026-01-01T12:00:00.000Z',
  editedAt: null,
  deleted: false,
};

describe('mappers: реакции', () => {
  it('превращает реакции сообщения в модели', () => {
    const m = toMessage({ ...base, reactions: [{ emoji: '👍', count: 2, userIds: [1, 2] }] });
    expect(m.reactions).toEqual([{ emoji: '👍', count: 2, userIds: [1, 2] }]);
  });

  it('сообщение без поля reactions получает пустой список', () => {
    expect(toMessage(base).reactions).toEqual([]);
  });

  it('toReaction подставляет пустой список пользователей', () => {
    expect(toReaction({ emoji: '🔥', count: 1 }).userIds).toEqual([]);
  });
});
