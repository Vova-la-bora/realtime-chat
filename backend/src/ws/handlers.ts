import { AppError } from '../errors';
import type { ChatGateway } from './chatGateway';
import { ChatConnection } from './connection';
import {
  DeleteMessageEvent,
  EditMessageEvent,
  JoinRoomEvent,
  LeaveRoomEvent,
  MarkReadEvent,
  PingEvent,
  SendMessageEvent,
  ToggleReactionEvent,
  TypingEvent,
} from './events';
import {
  deleteMessagePayload,
  editMessagePayload,
  joinRoomPayload,
  leaveRoomPayload,
  markReadPayload,
  sendMessagePayload,
  toggleReactionPayload,
  typingPayload,
} from './protocol';

// Собирает исходящий кадр
export class FrameBuilder {
  build(kind: string, data: unknown): string {
    return JSON.stringify({ type: kind, payload: data });
  }
}

// Обработчик одного типа входящих событий
export abstract class ChatEventHandler<E> {
  protected gateway: ChatGateway;

  constructor(gateway: ChatGateway) {
    this.gateway = gateway;
  }

  abstract parse(payload: unknown): E;

  abstract handle(conn: ChatConnection, event: E): Promise<void>;
}

export class JoinRoomHandler extends ChatEventHandler<JoinRoomEvent> {
  parse(payload: unknown): JoinRoomEvent {
    const p = joinRoomPayload.parse(payload);
    return new JoinRoomEvent(p.roomId);
  }

  async handle(conn: ChatConnection, event: JoinRoomEvent): Promise<void> {
    // Право проверяется на каждое событие: подписаться может только участник комнаты
    await this.gateway.container.getRoomService().doCheck(event.roomId, conn.userId);
    this.gateway.subscriptions.subscribe(event.roomId, conn);
    conn.rooms.add(event.roomId);
    conn.lastRoomId = event.roomId;
    // Подписка на канал Redis оформляется асинхронно: ждём её, чтобы после join_room
    // не потерять события, опубликованные другим инстансом
    await this.gateway.container.getBus().whenSubscribed(event.roomId);
  }
}

export class LeaveRoomHandler extends ChatEventHandler<LeaveRoomEvent> {
  parse(payload: unknown): LeaveRoomEvent {
    const p = leaveRoomPayload.parse(payload);
    return new LeaveRoomEvent(p.roomId);
  }

  async handle(conn: ChatConnection, event: LeaveRoomEvent): Promise<void> {
    this.gateway.subscriptions.unsubscribe(event.roomId, conn);
  }
}

export class SendMessageHandler extends ChatEventHandler<SendMessageEvent> {
  parse(payload: unknown): SendMessageEvent {
    const p = sendMessagePayload.parse(payload);
    return new SendMessageEvent(p.roomId, p.content, p.clientMsgId);
  }

  async handle(conn: ChatConnection, event: SendMessageEvent): Promise<void> {
    conn.pendingClientMsgId = event.clientMsgId;
    try {
      // Не более 20 сообщений за 10 секунд на пользователя (счётчик в Redis общий для всех инстансов)
      if (!(await this.allowedToSend(conn.userId))) {
        throw new AppError(
          429,
          'rate_limited',
          'Слишком много сообщений: не более 20 за 10 секунд',
        );
      }
      const result = await this.gateway.container
        .getMessageService()
        .send(event.roomId, conn.userId, event.content, event.clientMsgId);
      // Остальным подключениям комнаты (включая другие вкладки отправителя) уходит new_message.
      // Повторная отправка с тем же clientMsgId не рассылается второй раз.
      if (!result.duplicate) {
        this.gateway.broadcast(event.roomId, conn, 'new_message', { message: result.message });
      }
      // Отправителю уходит подтверждение
      conn
        .getSession()
        .getSocket()
        .send(
          new FrameBuilder().build('message_ack', {
            clientMsgId: event.clientMsgId,
            message: result.message,
          }),
        );
    } finally {
      conn.pendingClientMsgId = null;
    }
  }

  private async allowedToSend(userId: number): Promise<boolean> {
    try {
      return await this.gateway.container.getRateLimiter().allow('rl:msg:' + userId, 20, 10000);
    } catch (err) {
      // Если Redis недоступен, отправку не блокируем
      this.gateway.log.warn({ err }, 'Ограничитель частоты недоступен');
      return true;
    }
  }
}

export class EditMessageHandler extends ChatEventHandler<EditMessageEvent> {
  parse(payload: unknown): EditMessageEvent {
    const p = editMessagePayload.parse(payload);
    return new EditMessageEvent(p.messageId, p.content);
  }

  async handle(conn: ChatConnection, event: EditMessageEvent): Promise<void> {
    const message = await this.gateway.container
      .getMessageService()
      .edit(event.messageId, conn.userId, event.content);
    // Обновлённое сообщение получают все подключения комнаты, включая вкладку автора
    this.gateway.broadcast(message.roomId, null, 'message_edited', { message });
  }
}

export class DeleteMessageHandler extends ChatEventHandler<DeleteMessageEvent> {
  parse(payload: unknown): DeleteMessageEvent {
    const p = deleteMessagePayload.parse(payload);
    return new DeleteMessageEvent(p.messageId);
  }

  async handle(conn: ChatConnection, event: DeleteMessageEvent): Promise<void> {
    const result = await this.gateway.container
      .getMessageService()
      .remove(event.messageId, conn.userId);
    // Повторное удаление уже удалённого сообщения ничего не рассылает
    if (result.changed) {
      this.gateway.broadcast(result.roomId, null, 'message_deleted', {
        roomId: result.roomId,
        messageId: event.messageId,
      });
    }
  }
}

export class TypingHandler extends ChatEventHandler<TypingEvent> {
  parse(payload: unknown): TypingEvent {
    const p = typingPayload.parse(payload);
    return new TypingEvent(p.roomId);
  }

  async handle(conn: ChatConnection, event: TypingEvent): Promise<void> {
    await this.gateway.container.getRoomService().doCheck(event.roomId, conn.userId);
    this.gateway.broadcastToOthers(event.roomId, conn.userId, 'user_typing', {
      roomId: event.roomId,
      userId: conn.userId,
    });
  }
}

export class MarkReadHandler extends ChatEventHandler<MarkReadEvent> {
  parse(payload: unknown): MarkReadEvent {
    const p = markReadPayload.parse(payload);
    return new MarkReadEvent(p.roomId, p.messageId);
  }

  async handle(conn: ChatConnection, event: MarkReadEvent): Promise<void> {
    const updated = await this.gateway.container
      .getMessageService()
      .markRead(event.roomId, conn.userId, event.messageId);
    // Если отметка сдвинулась, об этом узнают собеседники и другие вкладки пользователя
    if (updated !== null) {
      this.gateway.broadcast(event.roomId, conn, 'message_read', {
        roomId: event.roomId,
        userId: conn.userId,
        messageId: updated,
      });
    }
  }
}

export class ToggleReactionHandler extends ChatEventHandler<ToggleReactionEvent> {
  parse(payload: unknown): ToggleReactionEvent {
    const p = toggleReactionPayload.parse(payload);
    return new ToggleReactionEvent(p.messageId, p.emoji);
  }

  async handle(conn: ChatConnection, event: ToggleReactionEvent): Promise<void> {
    const result = await this.gateway.container
      .getMessageService()
      .toggleReaction(event.messageId, conn.userId, event.emoji);
    // Обновлённый набор реакций получают все подключения комнаты, включая автора клика
    this.gateway.broadcast(result.roomId, null, 'reaction_updated', result);
  }
}

export class PingHandler extends ChatEventHandler<PingEvent> {
  parse(payload: unknown): PingEvent {
    return new PingEvent();
  }

  async handle(conn: ChatConnection, event: PingEvent): Promise<void> {
    // отправляем pong
    this.gateway.sendFrame(conn, 'pong', {});
  }
}
