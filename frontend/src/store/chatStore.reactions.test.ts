import { beforeEach, describe, expect, it } from 'vitest';
import { MessageModel, ReactionModel, RoomModel } from '../models';
import { useChatStore } from './chatStore';

function reaction(emoji: string, userIds: number[]): ReactionModel {
  const r = new ReactionModel();
  r.emoji = emoji;
  r.count = userIds.length;
  r.userIds = userIds;
  return r;
}

function message(roomId: number, id: number | null, clientMsgId: string): MessageModel {
  const m = new MessageModel();
  m.id = id;
  m.roomId = roomId;
  m.senderId = 2;
  m.clientMsgId = clientMsgId;
  m.content = `текст ${clientMsgId}`;
  m.createdAt = new Date(2026, 0, 1, 12, 0, id ?? 59).toISOString();
  m.status = id === null ? 'sending' : 'sent';
  return m;
}

const store = () => useChatStore.getState();

describe('chatStore: реакции', () => {
  beforeEach(() => {
    store().reset();
    const room = new RoomModel();
    room.id = 1;
    room.type = 'public';
    store().setRooms([room]);
    store().finishLoadLatest(1, [message(1, 10, 'a'), message(1, 11, 'b')], false, null);
  });

  it('новое сообщение приходит без реакций', () => {
    expect(store().messages[1].items.every((m) => m.reactions.length === 0)).toBe(true);
  });

  it('обновление реакций заменяет набор у нужного сообщения и не трогает остальные', () => {
    store().applyReactions(1, 10, [reaction('👍', [2, 3]), reaction('🔥', [3])]);
    const [first, second] = store().messages[1].items;
    expect(first.reactions.map((r) => [r.emoji, r.count])).toEqual([
      ['👍', 2],
      ['🔥', 1],
    ]);
    expect(second.reactions).toEqual([]);

    store().applyReactions(1, 10, [reaction('👍', [3])]);
    expect(store().messages[1].items[0].reactions.map((r) => r.count)).toEqual([1]);
  });

  it('пустой набор снимает все реакции', () => {
    store().applyReactions(1, 10, [reaction('👍', [2])]);
    store().applyReactions(1, 10, []);
    expect(store().messages[1].items[0].reactions).toEqual([]);
  });

  it('реакции сохраняются при правке и удалении сообщения', () => {
    store().applyReactions(1, 10, [reaction('❤️', [2])]);
    const edited = message(1, 10, 'a');
    edited.content = 'исправлено';
    edited.editedAt = new Date(2026, 0, 1, 12, 5).toISOString();
    store().applyEdited(edited);
    expect(store().messages[1].items[0]).toMatchObject({ content: 'исправлено' });
    expect(store().messages[1].items[0].reactions).toHaveLength(1);
  });

  it('обновление для неподтверждённого сообщения и чужой комнаты ничего не ломает', () => {
    store().addPending(message(1, null, 'local'));
    store().applyReactions(1, 999, [reaction('👍', [2])]);
    store().applyReactions(5, 10, [reaction('👍', [2])]);
    expect(store().messages[1].items.map((m) => m.reactions.length)).toEqual([0, 0, 0]);
    expect(store().messages[5].items).toEqual([]);
  });
});
