import { beforeEach, describe, expect, it } from 'vitest';
import { LastMessageModel, MemberModel, MessageModel, RoomModel } from '../models';
import { useChatStore } from './chatStore';

function room(id: number, unread = 0): RoomModel {
  const r = new RoomModel();
  r.id = id;
  r.type = 'direct';
  r.title = `Диалог ${id}`;
  r.unread = unread;
  return r;
}

function message(roomId: number, id: number, senderId: number, content = `текст ${id}`) {
  const m = new MessageModel();
  m.id = id;
  m.roomId = roomId;
  m.senderId = senderId;
  m.clientMsgId = `c${id}`;
  m.content = content;
  m.createdAt = new Date(2026, 0, 1, 12, 0, id).toISOString();
  return m;
}

function member(userId: number, online: boolean, lastRead = 0, lastSeenAt: string | null = null) {
  const m = new MemberModel();
  m.userId = userId;
  m.username = `user${userId}`;
  m.online = online;
  m.lastSeenAt = lastSeenAt;
  m.lastReadMessageId = lastRead;
  return m;
}

const store = () => useChatStore.getState();

describe('chatStore: статусы, прочитанное, «печатает», правка и удаление', () => {
  beforeEach(() => {
    store().reset();
    store().setRooms([room(1), room(2)]);
  });

  describe('присутствие', () => {
    it('список участников задаёт статусы и отметки «прочитано»', () => {
      store().setMembers(1, [member(5, true, 7), member(6, false, 3, '2026-01-01T10:00:00Z')]);
      expect(store().presence[5]).toEqual({ online: true, lastSeenAt: null });
      expect(store().presence[6]).toEqual({ online: false, lastSeenAt: '2026-01-01T10:00:00Z' });
      expect(store().reads[1]).toEqual({ 5: 7, 6: 3 });
    });

    it('presence_update: офлайн запоминает last_seen, онлайн его не стирает', () => {
      store().setPresence(5, false, '2026-01-01T10:00:00Z');
      store().setPresence(5, true, null);
      expect(store().presence[5]).toEqual({ online: true, lastSeenAt: '2026-01-01T10:00:00Z' });
      store().setPresence(5, false, '2026-01-01T11:00:00Z');
      expect(store().presence[5]).toEqual({ online: false, lastSeenAt: '2026-01-01T11:00:00Z' });
    });
  });

  describe('прочитано', () => {
    it('отметка собеседника двигается только вперёд', () => {
      store().setRead(1, 5, 10);
      store().setRead(1, 5, 4);
      expect(store().reads[1][5]).toBe(10);
      store().setRead(1, 5, 12);
      expect(store().reads[1][5]).toBe(12);
    });

    it('повторная загрузка участников не откатывает отметку назад', () => {
      store().setRead(1, 5, 10);
      store().setMembers(1, [member(5, true, 3)]);
      expect(store().reads[1][5]).toBe(10);
    });

    it('clearUnread обнуляет счётчик только указанной комнаты', () => {
      store().setRooms([room(1, 4), room(2, 3)]);
      store().clearUnread(1);
      expect(store().rooms.map((r) => r.unread)).toEqual([0, 3]);
    });
  });

  describe('«печатает…»', () => {
    it('добавляет пользователя один раз и убирает по команде', () => {
      store().setTyping(1, 5, true);
      store().setTyping(1, 5, true);
      store().setTyping(1, 6, true);
      expect(store().typing[1]).toEqual([5, 6]);
      store().setTyping(1, 5, false);
      expect(store().typing[1]).toEqual([6]);
    });

    it('сообщение от печатающего гасит индикатор', () => {
      store().finishLoadLatest(1, [], false, null);
      store().setTyping(1, 5, true);
      store().receiveMessage(message(1, 10, 5));
      expect(store().typing[1]).toEqual([]);
    });

    it('выход из комнаты очищает её «печатает» и отметки', () => {
      store().setTyping(2, 5, true);
      store().setRead(2, 5, 3);
      store().removeRoom(2);
      expect(store().typing[2]).toBeUndefined();
      expect(store().reads[2]).toBeUndefined();
    });
  });

  describe('правка и удаление', () => {
    it('правка меняет текст и отметку «изменено» в истории и в превью последнего сообщения', () => {
      store().finishLoadLatest(1, [message(1, 1, 5), message(1, 2, 5)], false, null);
      store().receiveMessage(message(1, 2, 5));
      const edited = message(1, 2, 5, 'новый текст');
      edited.editedAt = '2026-01-01T12:30:00Z';

      store().applyEdited(edited);
      const items = store().messages[1].items;
      expect(items[1]).toMatchObject({ content: 'новый текст', editedAt: '2026-01-01T12:30:00Z' });
      expect(items[0].content).toBe('текст 1');
      expect(store().rooms.find((r) => r.id === 1)?.lastMessage?.content).toBe('новый текст');
    });

    it('удаление ставит заглушку в истории и в превью, если это последнее сообщение', () => {
      store().finishLoadLatest(1, [message(1, 1, 5), message(1, 2, 5)], false, null);
      const last = new LastMessageModel();
      last.id = 2;
      last.content = 'текст 2';
      store().setRooms([{ ...room(1), lastMessage: last }, room(2)]);

      store().applyDeleted(1, 2);
      expect(store().messages[1].items[1]).toMatchObject({
        deleted: true,
        content: 'сообщение удалено',
      });
      expect(store().messages[1].items[0].deleted).toBe(false);
      expect(store().rooms.find((r) => r.id === 1)?.lastMessage?.content).toBe('сообщение удалено');
    });

    it('правка и удаление комнаты, которой нет в загруженных, ничего не ломают', () => {
      expect(() => {
        store().applyEdited(message(99, 5, 1));
        store().applyDeleted(99, 5);
      }).not.toThrow();
    });
  });
});
