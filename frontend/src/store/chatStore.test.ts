import { beforeEach, describe, expect, it } from 'vitest';
import { MessageModel, RoomModel } from '../models';
import { useChatStore } from './chatStore';

function room(id: number, unread = 0): RoomModel {
  const r = new RoomModel();
  r.id = id;
  r.type = 'public';
  r.title = `Комната ${id}`;
  r.role = 'member';
  r.unread = unread;
  return r;
}

function message(
  roomId: number,
  id: number | null,
  clientMsgId: string,
  senderId = 2,
): MessageModel {
  const m = new MessageModel();
  m.id = id;
  m.roomId = roomId;
  m.senderId = senderId;
  m.clientMsgId = clientMsgId;
  m.content = `текст ${clientMsgId}`;
  m.createdAt = new Date(2026, 0, 1, 12, 0, id ?? 59).toISOString();
  m.status = id === null ? 'sending' : 'sent';
  return m;
}

const store = () => useChatStore.getState();

describe('chatStore', () => {
  beforeEach(() => {
    store().reset();
    store().setRooms([room(1), room(2), room(3)]);
  });

  it('новое сообщение в неактивной комнате увеличивает счётчик и поднимает комнату наверх', () => {
    store().receiveMessage(message(3, 10, 'a'));
    expect(store().rooms.map((r) => r.id)).toEqual([3, 1, 2]);
    expect(store().rooms[0].unread).toBe(1);
    expect(store().rooms[0].lastMessage?.content).toBe('текст a');
  });

  it('новое сообщение в открытой комнате не увеличивает счётчик', () => {
    store().setActiveRoom(2);
    store().receiveMessage(message(2, 10, 'a'));
    expect(store().rooms.find((r) => r.id === 2)?.unread).toBe(0);
  });

  it('открытие комнаты обнуляет счётчик непрочитанных', () => {
    store().setRooms([room(1, 5), room(2, 3)]);
    store().setActiveRoom(1);
    expect(store().rooms.find((r) => r.id === 1)?.unread).toBe(0);
    expect(store().rooms.find((r) => r.id === 2)?.unread).toBe(3);
  });

  it('повторная загрузка списка комнат не возвращает непрочитанные в открытой комнате', () => {
    store().setActiveRoom(1);
    store().setRooms([room(1, 4), room(2)]);
    expect(store().rooms.find((r) => r.id === 1)?.unread).toBe(0);
  });

  it('сообщения из ещё не открытой комнаты не копятся в истории', () => {
    store().receiveMessage(message(1, 10, 'a'));
    expect(store().messages[1]).toBeUndefined();
  });

  it('входящее сообщение попадает в историю загруженной комнаты без дублей', () => {
    store().finishLoadLatest(1, [message(1, 1, 'a')], false, null);
    store().receiveMessage(message(1, 2, 'b'));
    store().receiveMessage(message(1, 2, 'b'));
    expect(store().messages[1].items.map((m) => m.id)).toEqual([1, 2]);
  });

  it('оптимистичное сообщение: сначала «отправляется», после ack становится «отправлено»', () => {
    store().finishLoadLatest(1, [], false, null);
    store().addPending(message(1, null, 'local', 7));
    expect(store().messages[1].items[0].status).toBe('sending');
    expect(store().rooms[0].id).toBe(1);

    store().confirmMessage(message(1, 42, 'local', 7));
    const items = store().messages[1].items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(42);
    expect(items[0].status).toBe('sent');
  });

  it('при обрыве связи неподтверждённые сообщения получают статус «ошибка»', () => {
    store().finishLoadLatest(1, [message(1, 1, 'a')], false, null);
    store().addPending(message(1, null, 'local', 7));
    store().failSending('Соединение потеряно');
    const items = store().messages[1].items;
    expect(items[0].status).toBe('sent');
    expect(items[1].status).toBe('error');
    expect(items[1].error).toBe('Соединение потеряно');
  });

  it('повтор отправки возвращает статус «отправляется» и убирает ошибку', () => {
    store().addPending(message(1, null, 'local', 7));
    store().markMessage(1, 'local', { status: 'error', error: 'Сервер не подтвердил отправку' });
    store().markMessage(1, 'local', { status: 'sending', error: null });
    const item = store().messages[1].items[0];
    expect(item.status).toBe('sending');
    expect(item.error).toBeNull();
  });

  it('подгрузка старых сообщений обновляет курсор и не трогает неподтверждённые', () => {
    store().finishLoadLatest(1, [message(1, 51, 'new')], true, 51);
    store().addPending(message(1, null, 'local', 7));
    store().finishLoadOlder(1, [message(1, 1, 'old1'), message(1, 2, 'old2')], false, null);
    const bucket = store().messages[1];
    expect(bucket.items.map((m) => m.clientMsgId)).toEqual(['old1', 'old2', 'new', 'local']);
    expect(bucket.hasMore).toBe(false);
    expect(bucket.nextCursor).toBeNull();
    expect(bucket.loading).toBe(false);
  });

  it('выход из комнаты убирает её и сообщения', () => {
    store().finishLoadLatest(2, [message(2, 1, 'a')], false, null);
    store().setActiveRoom(2);
    store().removeRoom(2);
    expect(store().rooms.map((r) => r.id)).toEqual([1, 3]);
    expect(store().messages[2]).toBeUndefined();
    expect(store().activeRoomId).toBeNull();
  });
});
