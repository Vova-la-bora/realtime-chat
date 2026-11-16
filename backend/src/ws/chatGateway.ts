import { randomUUID } from 'node:crypto';
import { IncomingMessage, Server } from 'node:http';
import { Duplex } from 'node:stream';
import { FastifyBaseLogger } from 'fastify';
import WebSocket, { RawData, WebSocketServer } from 'ws';
import { ZodError } from 'zod';
import { ServiceContainer } from '../container';
import { AppError } from '../errors';
import { ChatConnection } from './connection';
import {
  DeleteMessageHandler,
  EditMessageHandler,
  JoinRoomHandler,
  LeaveRoomHandler,
  MarkReadHandler,
  PingHandler,
  SendMessageHandler,
  ToggleReactionHandler,
  TypingHandler,
} from './handlers';
import { BusMessage } from '../pubsub/roomBus';
import { envelopeSchema, FrameEncoder } from './protocol';
import { RoomSubscriptions } from './roomSubscriptions';

// Шлюз WebSocket: принимает подключения, проверяет токен, разбирает кадры,
// раздаёт события обработчикам и рассылает ответы
export class ChatGateway {
  public wss: WebSocketServer;
  public connections = new Set<ChatConnection>();
  public container: ServiceContainer;
  public subscriptions: RoomSubscriptions;
  public log: FastifyBaseLogger;
  private joinHandler: JoinRoomHandler;
  private leaveHandler: LeaveRoomHandler;
  private sendHandler: SendMessageHandler;
  private pingHandler: PingHandler;
  private editHandler: EditMessageHandler;
  private deleteHandler: DeleteMessageHandler;
  private typingHandler: TypingHandler;
  private markReadHandler: MarkReadHandler;
  private reactionHandler: ToggleReactionHandler;
  private idleTimer: NodeJS.Timeout | null = null;
  // Фоновые задачи (учёт присутствия): при остановке дожидаемся их завершения
  private pendingTasks = new Set<Promise<unknown>>();
  // События, которые уже доставлены подключениям (чтобы статус не пришёл дважды из разных комнат)
  private seenEvents = new Map<string, { expires: number; conns: Set<string> }>();
  // Заполняется только пока обрабатывается кадр (нужно для логов)
  currentFrameType: string | null = null;

  constructor(container: ServiceContainer, log: FastifyBaseLogger) {
    this.container = container;
    this.subscriptions = container.getSubscriptions();
    this.log = log;
    // Шина между инстансами: чужие события доставляются локальным подключениям
    const bus = container.getBus();
    bus.onRoomMessage = (roomId, message) => this.onBusMessage(roomId, message);
    bus.onMembership = (event) =>
      this.subscriptions.applyRemote(event.kind, event.roomId, event.userId);
    this.subscriptions.listener = {
      roomActive: (roomId) => bus.subscribeRoom(roomId),
      roomIdle: (roomId) => bus.unsubscribeRoom(roomId),
    };
    this.subscriptions.onMembershipChange = (kind, roomId, userId) =>
      bus.publishMembership(kind, roomId, userId);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.joinHandler = new JoinRoomHandler(this);
    this.leaveHandler = new LeaveRoomHandler(this);
    this.sendHandler = new SendMessageHandler(this);
    this.pingHandler = new PingHandler(this);
    this.editHandler = new EditMessageHandler(this);
    this.deleteHandler = new DeleteMessageHandler(this);
    this.typingHandler = new TypingHandler(this);
    this.markReadHandler = new MarkReadHandler(this);
    this.reactionHandler = new ToggleReactionHandler(this);
  }

  // Подключается к HTTP-серверу Fastify и запускает проверку неактивных подключений
  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    this.idleTimer = setInterval(() => this.closeIdleConnections(), 15000);
    this.idleTimer.unref();
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, url.searchParams.get('token'));
    });
  }

  // Токен проверяется при рукопожатии; невалидный: закрытие с кодом 4401
  private onConnection(ws: WebSocket, token: string | null): void {
    let userId: number;
    try {
      userId = this.container.getAuthService().verifyAccessToken(token ?? '');
    } catch {
      ws.close(4401, 'unauthorized');
      return;
    }
    const conn = new ChatConnection(randomUUID(), ws, userId);
    this.connections.add(conn);
    this.subscriptions.addConnection(conn);
    conn.presenceReady = this.trackConnect(conn);
    this.track(conn.presenceReady);
    this.log.info({ connId: conn.id, userId }, 'WebSocket подключён');

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        this.sendError(conn, 'binary_not_supported', 'Поддерживаются только текстовые кадры');
        return;
      }
      conn.queue = conn.queue.then(() => this.processFrame(conn, raw));
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (err) => this.log.warn({ err, connId: conn.id }, 'Ошибка WebSocket'));
  }

  // Закрывает подключение
  private onClose(conn: ChatConnection): void {
    this.connections.delete(conn);
    this.subscriptions.removeConnection(conn);
    this.track(this.trackDisconnect(conn));
    this.log.info({ connId: conn.id, userId: conn.userId }, 'WebSocket отключён');
  }

  private track(task: Promise<unknown>): void {
    const done: Promise<unknown> = task
      .catch(() => undefined)
      .finally(() => this.pendingTasks.delete(done));
    this.pendingTasks.add(done);
  }

  // Подключение открыто: если это первое подключение пользователя, сообщаем, что он онлайн
  private async trackConnect(conn: ChatConnection): Promise<void> {
    try {
      const becameOnline = await this.container.getPresence().connected(conn.userId, conn.id);
      conn.lastPresenceTouchAt = Date.now();
      if (becameOnline) {
        await this.announcePresence(conn.userId, true, null);
      }
    } catch (err) {
      this.log.warn({ err, connId: conn.id }, 'Не удалось отметить подключение в Redis');
    }
  }

  // Подключение закрыто: если оно было последним, пользователь уходит в офлайн
  private async trackDisconnect(conn: ChatConnection): Promise<void> {
    await conn.presenceReady;
    try {
      const result = await this.container.getPresence().disconnected(conn.userId, conn.id);
      if (result.offline) {
        await this.announcePresence(conn.userId, false, result.lastSeenAt);
      }
    } catch (err) {
      this.log.warn({ err, connId: conn.id }, 'Не удалось снять отметку подключения в Redis');
    }
  }

  // Сообщает изменение статуса всем, кто слушает общие с пользователем комнаты
  async announcePresence(userId: number, online: boolean, lastSeenAt: Date | null): Promise<void> {
    const presence = this.container.getPresence();
    const roomIds = await presence.roomIdsOf(userId);
    const payload = presence.buildFrame(userId, online, lastSeenAt);
    // Одно событие уходит в каналы всех общих комнат; подключение, которое сидит сразу в
    // нескольких из них, получит его один раз (eventId)
    const eventId = randomUUID();
    for (const roomId of roomIds) {
      this.deliverLocal(roomId, 'presence_update', payload, null, userId, eventId);
      this.container
        .getBus()
        .publishRoom(roomId, 'presence_update', payload, null, userId, true, eventId);
    }
  }

  // Доставка события локальным подключениям комнаты. exceptConnId и exceptUserId исключают
  // получателей, dedupeId (если задан) не даёт отправить одно событие подключению дважды.
  private deliverLocal(
    roomId: number,
    type: string,
    payload: unknown,
    exceptConnId: string | null,
    exceptUserId: number | null,
    dedupeId: string | null = null,
  ): void {
    const seen = dedupeId ? this.rememberEvent(dedupeId) : null;
    for (const conn of this.subscriptions.connectionsOf(roomId)) {
      if (conn.id === exceptConnId || conn.userId === exceptUserId) {
        continue;
      }
      if (seen) {
        if (seen.has(conn.id)) {
          continue;
        }
        seen.add(conn.id);
      }
      this.sendFrame(conn, type, payload);
    }
  }

  // Запоминает событие на 10 секунд и возвращает множество подключений, которым оно уже ушло
  private rememberEvent(eventId: string): Set<string> {
    const now = Date.now();
    for (const [id, entry] of this.seenEvents) {
      if (entry.expires < now) {
        this.seenEvents.delete(id);
      }
    }
    let entry = this.seenEvents.get(eventId);
    if (!entry) {
      entry = { expires: now + 10000, conns: new Set() };
      this.seenEvents.set(eventId, entry);
    }
    return entry.conns;
  }

  // Событие из канала комнаты, опубликованное другим инстансом
  private onBusMessage(roomId: number, message: BusMessage): void {
    this.deliverLocal(
      roomId,
      message.type,
      message.payload,
      message.exceptConnId,
      message.exceptUserId,
      message.dedupe ? message.eventId : null,
    );
  }

  // Разбор кадра: JSON, затем конверт { type, payload }
  async processFrame(conn: ChatConnection, raw: RawData): Promise<void> {
    conn.lastActivityAt = Date.now();
    // Heartbeat присутствия: продлеваем запись в Redis не чаще раза в 20 секунд
    if (conn.lastActivityAt - conn.lastPresenceTouchAt > 20000) {
      conn.lastPresenceTouchAt = conn.lastActivityAt;
      this.track(
        this.container
          .getPresence()
          .touch(conn.userId, conn.id)
          .catch((err) =>
            this.log.warn({ err, connId: conn.id }, 'Не удалось продлить присутствие'),
          ),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      this.sendError(conn, 'invalid_json', 'Кадр должен быть корректным JSON');
      return;
    }
    const envelope = envelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      this.sendError(conn, 'invalid_frame', 'Ожидается объект { type, payload }');
      return;
    }
    this.currentFrameType = envelope.data.type;
    await this.dispatch(conn, envelope.data.type, envelope.data.payload);
    this.currentFrameType = null;
  }

  private async dispatch(conn: ChatConnection, type: string, payload: unknown): Promise<void> {
    switch (type) {
      case 'join_room':
        try {
          const event = this.joinHandler.parse(payload);
          await this.joinHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'leave_room':
        try {
          const event = this.leaveHandler.parse(payload);
          await this.leaveHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'send_message':
        try {
          const event = this.sendHandler.parse(payload);
          await this.sendHandler.handle(conn, event);
        } catch (err) {
          const ref = (payload as { clientMsgId?: unknown }).clientMsgId;
          this.reportError(conn, err, typeof ref === 'string' ? ref : undefined);
        }
        break;
      case 'edit_message':
        try {
          const event = this.editHandler.parse(payload);
          await this.editHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'delete_message':
        try {
          const event = this.deleteHandler.parse(payload);
          await this.deleteHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'typing':
        try {
          const event = this.typingHandler.parse(payload);
          await this.typingHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'mark_read':
        try {
          const event = this.markReadHandler.parse(payload);
          await this.markReadHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'toggle_reaction':
        try {
          const event = this.reactionHandler.parse(payload);
          await this.reactionHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      case 'ping':
        try {
          const event = this.pingHandler.parse(payload);
          await this.pingHandler.handle(conn, event);
        } catch (err) {
          this.reportError(conn, err);
        }
        break;
      default:
        this.sendError(conn, 'unknown_type', `Неизвестный тип события: ${type}`);
    }
  }

  // Преобразует исключение в событие error
  private reportError(conn: ChatConnection, err: unknown, refTo?: string): void {
    if (err instanceof AppError) {
      this.sendError(conn, err.code, err.message, refTo);
    } else if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.sendError(conn, 'validation_error', message, refTo);
    } else {
      this.log.error({ err, connId: conn.id, type: this.currentFrameType }, 'Ошибка обработки');
      this.sendError(conn, 'internal_error', 'Внутренняя ошибка сервера', refTo);
    }
  }

  sendError(conn: ChatConnection, code: string, message: string, refTo?: string): void {
    this.sendFrame(conn, 'error', { code, message, refTo });
  }

  sendFrame(conn: ChatConnection, type: string, payload: unknown): void {
    const socket = conn.getSession().getSocket();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(FrameEncoder.encode(type, payload));
    }
  }

  // Рассылает событие всем подключениям комнаты, кроме указанного: сначала локальным,
  // затем через Redis остальным инстансам
  broadcast(roomId: number, except: ChatConnection | null, type: string, payload: unknown): void {
    this.deliverLocal(roomId, type, payload, except?.id ?? null, null);
    this.container.getBus().publishRoom(roomId, type, payload, except?.id ?? null, null, false);
  }

  // Рассылает событие всем подключениям комнаты, кроме подключений указанного пользователя
  broadcastToOthers(roomId: number, userId: number, type: string, payload: unknown): void {
    this.deliverLocal(roomId, type, payload, null, userId);
    this.container.getBus().publishRoom(roomId, type, payload, null, userId, false);
  }

  // Клиент шлёт ping каждые 25 с; без активности дольше 60 с подключение закрывается
  private closeIdleConnections(): void {
    const now = Date.now();
    for (const conn of this.connections) {
      if (now - conn.lastActivityAt > 60000) {
        conn.getSession().getSocket().close(4408, 'idle timeout');
      }
    }
  }

  // Корректное завершение: закрываем подключения и сам сервер
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
    }
    for (const conn of this.connections) {
      conn.getSession().getSocket().close(1001, 'server shutting down');
    }
    const deadline = Date.now() + 2000;
    while (this.connections.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const conn of this.connections) {
      conn.getSession().getSocket().terminate();
    }
    // Дожидаемся записи last_seen_at и рассылки статусов, пока БД и Redis ещё открыты
    await Promise.allSettled([...this.pendingTasks]);
    await this.container.getBus().close();
    this.wss.close();
  }
}
