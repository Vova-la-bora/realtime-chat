import { AppError } from '../errors';
import { MessageRecord } from '../models';
import { MessageRepository } from '../repositories/messageRepository';
import { ReactionJson, ReactionRepository } from '../repositories/reactionRepository';
import { RoomRepository } from '../repositories/roomRepository';

export interface MessageJson {
  id: number;
  roomId: number;
  senderId: number;
  clientMsgId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  reactions: ReactionJson[];
}

export class MessageService {
  public messages: MessageRepository;
  public rooms: RoomRepository;
  public reactions: ReactionRepository;

  constructor(messages: MessageRepository, rooms: RoomRepository, reactions: ReactionRepository) {
    this.messages = messages;
    this.rooms = rooms;
    this.reactions = reactions;
  }

  // История комнаты: курсорная пагинация по before_id, 50 сообщений на страницу
  async getHistory(roomId: number, userId: number, beforeId: number | undefined, limit: number) {
    const room = await this.rooms.findById(roomId);
    if (!room) {
      throw new AppError(404, 'room_not_found', 'Комната не найдена');
    }
    const member = await this.rooms.getMember(roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    // const total = await this.messages.count(roomId);
    // if (limit > 200) limit = 200;
    const rows = await this.messages.history(roomId, beforeId ?? null, limit + 1);
    return this.buildPage(rows, limit);
  }

  // Поиск по сообщениям комнаты (полнотекстовый, PostgreSQL), курсорная пагинация как в истории
  async search(
    roomId: number,
    userId: number,
    query: string,
    beforeId: number | undefined,
    limit: number,
  ) {
    const member = await this.rooms.getMember(roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    const rows = await this.messages.search(roomId, query, beforeId ?? null, limit + 1);
    return this.buildPage(rows, limit);
  }

  // Общая обработка страницы для истории и поиска сообщений.
  private async buildPage(rows: MessageRecord[], limit: number) {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;
    const reactions = await this.reactions.listForMessages(page.map((message) => message.id));
    return { items: this.process(page, reactions), hasMore, nextCursor };
  }

  // Поставить или снять реакцию. Возвращает актуальный набор реакций сообщения.
  async toggleReaction(
    messageId: number,
    userId: number,
    emoji: string,
  ): Promise<{ roomId: number; messageId: number; reactions: ReactionJson[] }> {
    const message = await this.messages.findById(messageId);
    if (!message) {
      throw new AppError(404, 'message_not_found', 'Сообщение не найдено');
    }
    const member = await this.rooms.getMember(message.roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    if (message.deletedAt) {
      throw new AppError(400, 'message_deleted', 'Сообщение уже удалено');
    }
    await this.reactions.toggle(messageId, userId, emoji);
    const reactions = await this.reactions.listForMessages([messageId]);
    return { roomId: message.roomId, messageId, reactions: reactions.get(messageId) ?? [] };
  }

  // Отправка сообщения (вызывается из WebSocket). Права проверяются на каждую отправку.
  async send(
    roomId: number,
    userId: number,
    content: string,
    clientMsgId: string,
  ): Promise<{ message: MessageJson; duplicate: boolean }> {
    const member = await this.rooms.getMember(roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    const saved = await this.messages.insertIdempotent(roomId, userId, content, clientMsgId);
    return { message: this.formatMessage(saved.message), duplicate: saved.duplicate };
  }

  // Редактирование своего сообщения. Права проверяются на каждое событие.
  async edit(messageId: number, userId: number, content: string): Promise<MessageJson> {
    const message = await this.messages.findById(messageId);
    if (!message) {
      throw new AppError(404, 'message_not_found', 'Сообщение не найдено');
    }
    const member = await this.rooms.getMember(message.roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    if (message.senderId !== userId) {
      throw new AppError(403, 'forbidden', 'Редактировать можно только свои сообщения');
    }
    if (message.deletedAt) {
      throw new AppError(400, 'message_deleted', 'Сообщение уже удалено');
    }
    const updated = await this.messages.updateContent(messageId, content);
    if (!updated) {
      throw new AppError(400, 'message_deleted', 'Сообщение уже удалено');
    }
    return this.formatMessage(updated);
  }

  // Мягкое удаление своего сообщения. changed = false, если оно уже было удалено.
  async remove(messageId: number, userId: number): Promise<{ roomId: number; changed: boolean }> {
    const message = await this.messages.findById(messageId);
    if (!message) {
      throw new AppError(404, 'message_not_found', 'Сообщение не найдено');
    }
    const member = await this.rooms.getMember(message.roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    if (message.senderId !== userId) {
      throw new AppError(403, 'forbidden', 'Удалять можно только свои сообщения');
    }
    const changed = await this.messages.softDelete(messageId);
    return { roomId: message.roomId, changed };
  }

  // Отметка «прочитано» до сообщения messageId. Возвращает новое значение или null,
  // если отметка не сдвинулась (уже прочитано)
  async markRead(roomId: number, userId: number, messageId: number): Promise<number | null> {
    const member = await this.rooms.getMember(roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    const exists = await this.messages.existsInRoom(messageId, roomId);
    if (!exists) {
      throw new AppError(400, 'invalid_message', 'Такого сообщения нет в этой комнате');
    }
    return this.rooms.markRead(roomId, userId, messageId);
  }

  process(
    rows: MessageRecord[],
    reactions: Map<number, ReactionJson[]> = new Map(),
  ): MessageJson[] {
    return rows.map((d) => this.formatMessage(d, reactions.get(d.id) ?? []));
  }

  formatMessage(m: MessageRecord, reactions: ReactionJson[] = []): MessageJson {
    return {
      id: m.id,
      roomId: m.roomId,
      senderId: m.senderId,
      clientMsgId: m.clientMsgId,
      content: m.deletedAt ? 'сообщение удалено' : m.content,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deleted: m.deletedAt !== null,
      reactions,
    };
  }
}
