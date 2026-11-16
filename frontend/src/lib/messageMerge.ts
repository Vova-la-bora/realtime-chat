import { MessageModel } from '../models';

// Ключ сообщения: clientMsgId уникален в пределах отправителя
export function messageKey(m: MessageModel): string {
  return `${m.senderId}:${m.clientMsgId}`;
}

// Порядок: сначала сообщения сервера по id, затем неподтверждённые по времени создания
export function compareMessages(a: MessageModel, b: MessageModel): number {
  if (a.id !== null && b.id !== null) {
    return a.id - b.id;
  }
  if (a.id !== null) {
    return -1;
  }
  if (b.id !== null) {
    return 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

// Объединяет списки: дубли схлопываются, версия сервера заменяет локальную
export function mergeMessages(existing: MessageModel[], incoming: MessageModel[]): MessageModel[] {
  const byKey = new Map<string, MessageModel>();
  for (const m of existing) {
    byKey.set(messageKey(m), m);
  }
  for (const m of incoming) {
    const prev = byKey.get(messageKey(m));
    if (!prev || m.id !== null) {
      byKey.set(messageKey(m), m);
    }
  }
  return [...byKey.values()].sort(compareMessages);
}

// Наибольший id среди подтверждённых сообщений (0, если таких нет)
export function lastServerId(items: MessageModel[]): number {
  let max = 0;
  for (const m of items) {
    if (m.id !== null && m.id > max) {
      max = m.id;
    }
  }
  return max;
}
