import { describe, expect, it } from 'vitest';
import { MessageModel } from '../models';
import { lastServerId, mergeMessages } from './messageMerge';

function server(id: number, clientMsgId = `c${id}`, senderId = 1): MessageModel {
  const m = new MessageModel();
  m.id = id;
  m.roomId = 1;
  m.senderId = senderId;
  m.clientMsgId = clientMsgId;
  m.content = `сообщение ${id}`;
  m.createdAt = new Date(2026, 0, 1, 12, 0, id).toISOString();
  m.status = 'sent';
  return m;
}

function pending(clientMsgId: string, second: number, senderId = 1): MessageModel {
  const m = new MessageModel();
  m.id = null;
  m.roomId = 1;
  m.senderId = senderId;
  m.clientMsgId = clientMsgId;
  m.content = `черновик ${clientMsgId}`;
  m.createdAt = new Date(2026, 0, 1, 13, 0, second).toISOString();
  m.status = 'sending';
  return m;
}

describe('mergeMessages', () => {
  it('сортирует серверные сообщения по возрастанию id', () => {
    const merged = mergeMessages([], [server(3), server(1), server(2)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('ставит неподтверждённые сообщения после серверных, в порядке создания', () => {
    const merged = mergeMessages([pending('b', 2), pending('a', 1)], [server(5), server(4)]);
    expect(merged.map((m) => m.clientMsgId)).toEqual(['c4', 'c5', 'a', 'b']);
  });

  it('заменяет локальное сообщение серверной версией с тем же clientMsgId', () => {
    const merged = mergeMessages([pending('abc', 1)], [server(7, 'abc')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(7);
    expect(merged[0].status).toBe('sent');
  });

  it('не создаёт дублей, если одну и ту же страницу получили дважды', () => {
    const page = [server(1), server(2), server(3)];
    const once = mergeMessages([], page);
    const twice = mergeMessages(once, page);
    expect(twice).toHaveLength(3);
  });

  it('не затирает серверное сообщение локальным черновиком', () => {
    const merged = mergeMessages([server(7, 'abc')], [pending('abc', 1)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(7);
  });

  it('различает одинаковые clientMsgId у разных отправителей', () => {
    const merged = mergeMessages([], [server(1, 'same', 1), server(2, 'same', 2)]);
    expect(merged).toHaveLength(2);
  });

  it('подгрузка старых сообщений встаёт перед уже загруженными', () => {
    const newest = mergeMessages([], [server(51), server(52), server(53)]);
    const merged = mergeMessages(newest, [server(1), server(2)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 51, 52, 53]);
  });
});

describe('lastServerId', () => {
  it('возвращает наибольший id среди подтверждённых сообщений', () => {
    expect(lastServerId([server(3), pending('x', 1), server(9), server(5)])).toBe(9);
  });

  it('возвращает 0, если подтверждённых сообщений нет', () => {
    expect(lastServerId([])).toBe(0);
    expect(lastServerId([pending('x', 1)])).toBe(0);
  });
});
