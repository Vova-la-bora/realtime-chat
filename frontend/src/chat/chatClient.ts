import { roomsApi } from '../api/api';
import { ApiError, http } from '../api/http';
import { toMessage, toReaction } from '../api/mappers';
import { reconnectDelay } from '../lib/backoff';
import { lastServerId } from '../lib/messageMerge';
import { newUuid } from '../lib/uuid';
import { MessageModel } from '../models';
import { clearSession, useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

interface Frame {
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

function describeError(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Что-то пошло не так';
}

// Клиент чата: держит WebSocket, переподключается, отправляет сообщения,
// загружает историю и синхронизирует состояние со стором
export class ChatClient {
  public socket: WebSocket | null = null;
  public attempt = 0;
  public reconnectTimer: number | null = null;
  public pingTimer: number | null = null;
  public ackTimers = new Map<string, number>();
  private running = false;
  private hasConnectedBefore = false;
  private membersInFlight = new Set<number>();
  private roomsReloading = false;
  // До какого сообщения мы уже сообщили серверу «прочитано» (по комнатам)
  private lastReadSent = new Map<number, number>();
  private lastTypingSentAt = new Map<number, number>();
  // Таймеры «печатает…»: через 3 секунды без событий индикатор гаснет
  private typingTimers = new Map<string, number>();
  // Заполняются только на время синхронизации и обработки ошибки
  currentSyncRoom: number | null = null;
  lastErrorText: string | null = null;

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    window.addEventListener('online', this.handleOnline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    void this.loadRooms();
    this.connect();
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('online', this.handleOnline);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectionTimers();
    for (const timer of this.typingTimers.values()) {
      window.clearTimeout(timer);
    }
    this.typingTimers.clear();
    this.lastReadSent.clear();
    this.lastTypingSentAt.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.hasConnectedBefore = false;
    this.attempt = 0;
    useChatStore.getState().setConnection('offline');
  }

  // Браузер сообщил, что сеть вернулась: не ждём очередной попытки
  private handleOnline = (): void => {
    if (!this.running || this.isOpen()) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.connect();
  };

  // Вкладка снова видна: прочитанное в открытой комнате нужно отметить
  private handleVisibility = (): void => {
    const roomId = useChatStore.getState().activeRoomId;
    if (roomId !== null) {
      this.markRoomRead(roomId);
    }
  };

  isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    const token = http.token;
    if (!token || !this.running) {
      return;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    useChatStore.getState().setConnection('connecting');
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${scheme}://${window.location.host}/ws?token=${encodeURIComponent(token)}`,
    );
    this.socket = ws;
    // Обработчики игнорируют события устаревшего сокета
    ws.onopen = () => {
      if (this.socket === ws) {
        this.onOpen();
      }
    };
    ws.onmessage = (ev) => {
      if (this.socket === ws) {
        this.onMessage(ev.data);
      }
    };
    ws.onclose = (ev) => {
      if (this.socket === ws) {
        this.onClose(ev.code);
      }
    };
    ws.onerror = () => {
      // ошибка сети: следом придёт close, там и запланируем переподключение
    };
  }

  private onOpen(): void {
    this.attempt = 0;
    useChatStore.getState().setConnection('online');
    this.pingTimer = window.setInterval(() => this.send('ping', {}), 25000);
    this.joinRooms();
    if (this.hasConnectedBefore) {
      void this.refreshAfterReconnect();
    }
    this.hasConnectedBefore = true;
  }

  private onClose(code: number): void {
    this.clearConnectionTimers();
    this.socket = null;
    const store = useChatStore.getState();
    store.setConnection('offline');
    store.failSending('Соединение потеряно');
    if (!this.running) {
      return;
    }
    if (code === 4401) {
      // Access-токен просрочен: обновляем его и подключаемся заново
      void http.refreshToken().then((ok) => {
        if (!this.running) {
          return;
        }
        if (ok) {
          this.connect();
        } else {
          clearSession();
        }
      });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearConnectionTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const timer of this.ackTimers.values()) {
      window.clearTimeout(timer);
    }
    this.ackTimers.clear();
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    const store = useChatStore.getState();
    switch (frame.type) {
      case 'message_ack': {
        const message = toMessage(frame.payload.message);
        this.clearAckTimer(message.clientMsgId);
        store.confirmMessage(message);
        break;
      }
      case 'new_message': {
        const message = toMessage(frame.payload.message);
        store.receiveMessage(message);
        // Пишет участник, которого мы ещё не знаем (вошёл после открытия комнаты)
        const members = store.members[message.roomId];
        if (members && !members.some((m) => m.userId === message.senderId)) {
          void this.loadMembers(message.roomId);
        }
        // Сообщение из комнаты, которой нет в списке (например, новый личный диалог)
        if (!store.rooms.some((r) => r.id === message.roomId)) {
          void this.reloadRoomsOnce();
        }
        this.clearTypingTimer(message.roomId, message.senderId);
        if (store.activeRoomId === message.roomId) {
          this.markRoomRead(message.roomId);
        }
        break;
      }
      case 'message_edited':
        store.applyEdited(toMessage(frame.payload.message));
        break;
      case 'message_deleted': {
        const { roomId, messageId } = frame.payload;
        store.applyDeleted(roomId, messageId);
        // Счётчик непрочитанных мог измениться на сервере: сверяемся со списком
        if (store.activeRoomId !== roomId) {
          void this.reloadRoomsOnce();
        }
        break;
      }
      case 'reaction_updated': {
        const { roomId, messageId } = frame.payload;
        const reactions = (frame.payload.reactions as unknown[]).map(toReaction);
        store.applyReactions(roomId, messageId, reactions);
        // Отреагировал участник, которого мы ещё не знаем: обновляем список, чтобы показать имя
        const members = store.members[roomId];
        const unknown = reactions.some((r) =>
          r.userIds.some((id) => !members?.some((m) => m.userId === id)),
        );
        if (members && unknown) {
          void this.loadMembers(roomId);
        }
        break;
      }
      case 'user_typing': {
        const { roomId, userId } = frame.payload;
        this.showTyping(roomId, userId);
        break;
      }
      case 'presence_update': {
        const { userId, online, lastSeenAt } = frame.payload;
        store.setPresence(userId, online, lastSeenAt);
        break;
      }
      case 'message_read': {
        const { roomId, userId, messageId } = frame.payload;
        store.setRead(roomId, userId, messageId);
        // Это наша же отметка с другой вкладки: счётчик здесь тоже сбрасываем
        if (userId === useAuthStore.getState().user?.id) {
          store.clearUnread(roomId);
          this.lastReadSent.set(roomId, Math.max(this.lastReadSent.get(roomId) ?? 0, messageId));
        }
        break;
      }
      case 'error':
        this.handleError(frame.payload);
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  private handleError(payload: { code: string; message: string; refTo?: string }): void {
    const store = useChatStore.getState();
    this.lastErrorText = payload.message;
    const refTo = payload.refTo;
    if (refTo) {
      // Ошибка относится к конкретному отправленному сообщению
      this.clearAckTimer(refTo);
      for (const [roomId, bucket] of Object.entries(store.messages)) {
        if (bucket.items.some((m) => m.clientMsgId === refTo && m.id === null)) {
          store.markMessage(Number(roomId), refTo, { status: 'error', error: payload.message });
        }
      }
      return;
    }
    store.setNotice(payload.message);
  }

  send(type: string, payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  // Подписываемся на события всех комнат пользователя
  joinRooms(): void {
    for (const room of useChatStore.getState().rooms) {
      this.send('join_room', { roomId: room.id });
    }
  }

  // После обрыва связи: обновляем список комнат и догружаем пропущенные сообщения
  private async refreshAfterReconnect(): Promise<void> {
    await this.loadRooms();
    for (const [id, bucket] of Object.entries(useChatStore.getState().messages)) {
      if (bucket.loaded) {
        await this.syncMissed(Number(id));
      }
    }
  }

  // Пропущенные сообщения: листаем историю от новых к старым, пока не дойдём до последнего
  // известного id. Если разрыв слишком большой, оставляем только свежие сообщения.
  async syncMissed(roomId: number): Promise<void> {
    const known = useChatStore.getState().messages[roomId];
    if (!known || !known.loaded) {
      return;
    }
    this.currentSyncRoom = roomId;
    try {
      const lastKnown = lastServerId(known.items);
      const collected: MessageModel[] = [];
      let cursor: number | null = null;
      let hasMore = false;
      let converged = false;
      for (let page = 0; page < 10; page += 1) {
        const res = await roomsApi.history(roomId, cursor, 50);
        collected.push(...res.items);
        hasMore = res.hasMore;
        cursor = res.nextCursor;
        const oldest = res.items.length > 0 ? (res.items[res.items.length - 1].id ?? 0) : 0;
        if (!res.hasMore || oldest <= lastKnown) {
          converged = true;
          break;
        }
      }
      const store = useChatStore.getState();
      if (converged) {
        store.mergeIntoRoom(roomId, collected);
      } else {
        store.replaceRoomMessages(roomId, collected, hasMore, cursor);
      }
      this.markRoomRead(roomId);
    } catch {
      // не получилось: повторим при следующем переподключении
    } finally {
      this.currentSyncRoom = null;
    }
  }

  async loadRooms(): Promise<void> {
    try {
      const rooms = await roomsApi.list();
      useChatStore.getState().setRooms(rooms);
      this.joinRooms();
    } catch (e) {
      useChatStore.getState().setNotice(`Не удалось загрузить комнаты: ${describeError(e)}`);
    }
  }

  async openRoom(roomId: number): Promise<void> {
    const store = useChatStore.getState();
    store.setActiveRoom(roomId);
    void this.loadMembers(roomId);
    const bucket = store.messages[roomId];
    if (bucket && (bucket.loaded || bucket.loading)) {
      this.markRoomRead(roomId);
      return;
    }
    await this.loadLatest(roomId);
  }

  closeRoom(roomId: number): void {
    if (useChatStore.getState().activeRoomId === roomId) {
      useChatStore.getState().setActiveRoom(null);
    }
  }

  async loadLatest(roomId: number): Promise<void> {
    useChatStore.getState().startLoading(roomId);
    try {
      const res = await roomsApi.history(roomId, null, 50);
      useChatStore.getState().finishLoadLatest(roomId, res.items, res.hasMore, res.nextCursor);
      this.markRoomRead(roomId);
    } catch (e) {
      useChatStore.getState().failLoading(roomId, describeError(e));
    }
  }

  // Подгрузка старых сообщений при прокрутке вверх
  async loadOlder(roomId: number): Promise<void> {
    const bucket = useChatStore.getState().messages[roomId];
    if (!bucket || bucket.loading || !bucket.hasMore || bucket.nextCursor === null) {
      return;
    }
    useChatStore.getState().startLoading(roomId);
    try {
      const res = await roomsApi.history(roomId, bucket.nextCursor, 50);
      useChatStore.getState().finishLoadOlder(roomId, res.items, res.hasMore, res.nextCursor);
    } catch (e) {
      useChatStore.getState().failLoading(roomId, describeError(e));
    }
  }

  async loadMembers(roomId: number): Promise<void> {
    if (this.membersInFlight.has(roomId)) {
      return;
    }
    this.membersInFlight.add(roomId);
    try {
      const members = await roomsApi.members(roomId);
      useChatStore.getState().setMembers(roomId, members);
    } catch {
      // участники нужны только для подписей к сообщениям: без них показываем id
    } finally {
      this.membersInFlight.delete(roomId);
    }
  }

  // Сообщает серверу «прочитано», если комната открыта, вкладка видна и есть что отмечать
  markRoomRead(roomId: number): void {
    if (document.visibilityState !== 'visible') {
      return;
    }
    const store = useChatStore.getState();
    if (store.activeRoomId !== roomId) {
      return;
    }
    const bucket = store.messages[roomId];
    if (!bucket || !bucket.loaded) {
      return;
    }
    const lastId = lastServerId(bucket.items);
    if (lastId === 0) {
      return;
    }
    store.clearUnread(roomId);
    if ((this.lastReadSent.get(roomId) ?? 0) >= lastId) {
      return;
    }
    if (this.send('mark_read', { roomId, messageId: lastId })) {
      this.lastReadSent.set(roomId, lastId);
    }
  }

  // «Печатает…»: событие уходит не чаще раза в 2 секунды
  notifyTyping(roomId: number): void {
    const now = Date.now();
    if (now - (this.lastTypingSentAt.get(roomId) ?? 0) < 2000) {
      return;
    }
    this.lastTypingSentAt.set(roomId, now);
    this.send('typing', { roomId });
  }

  private showTyping(roomId: number, userId: number): void {
    useChatStore.getState().setTyping(roomId, userId, true);
    this.clearTypingTimer(roomId, userId, false);
    const key = `${roomId}:${userId}`;
    this.typingTimers.set(
      key,
      window.setTimeout(() => {
        this.typingTimers.delete(key);
        useChatStore.getState().setTyping(roomId, userId, false);
      }, 3000),
    );
  }

  private clearTypingTimer(roomId: number, userId: number, hide = true): void {
    const key = `${roomId}:${userId}`;
    const timer = this.typingTimers.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.typingTimers.delete(key);
    }
    if (hide) {
      useChatStore.getState().setTyping(roomId, userId, false);
    }
  }

  // Обновляет список комнат, но не чаще одного запроса за раз
  private async reloadRoomsOnce(): Promise<void> {
    if (this.roomsReloading) {
      return;
    }
    this.roomsReloading = true;
    try {
      await this.loadRooms();
    } finally {
      this.roomsReloading = false;
    }
  }

  // Правка и удаление: результат приходит событием message_edited / message_deleted
  editMessage(messageId: number, content: string): void {
    if (!this.send('edit_message', { messageId, content })) {
      useChatStore.getState().setNotice('Нет соединения: изменения не отправлены');
    }
  }

  deleteMessage(messageId: number): void {
    if (!this.send('delete_message', { messageId })) {
      useChatStore.getState().setNotice('Нет соединения: сообщение не удалено');
    }
  }

  // Поставить или снять реакцию: новый набор реакций приходит событием reaction_updated
  toggleReaction(messageId: number, emoji: string): void {
    if (!this.send('toggle_reaction', { messageId, emoji })) {
      useChatStore.getState().setNotice('Нет соединения: реакция не отправлена');
    }
  }

  // Открывает личный диалог (создаёт, если его ещё нет) и возвращает id комнаты
  async openDirect(userId: number): Promise<number> {
    const roomId = await roomsApi.openDirect(userId);
    await this.loadRooms();
    return roomId;
  }

  async createRoom(name: string, type: string): Promise<number> {
    const roomId = await roomsApi.create(name, type);
    await this.loadRooms();
    return roomId;
  }

  async joinPublic(roomId: number): Promise<void> {
    await roomsApi.join(roomId);
    await this.loadRooms();
  }

  async leaveRoom(roomId: number): Promise<void> {
    await roomsApi.leave(roomId);
    this.send('leave_room', { roomId });
    useChatStore.getState().removeRoom(roomId);
  }

  // Оптимистичная отправка: сообщение сразу появляется со статусом «отправляется»
  sendMessage(roomId: number, content: string): void {
    const me = useAuthStore.getState().user;
    if (!me) {
      return;
    }
    const message = new MessageModel();
    message.roomId = roomId;
    message.senderId = me.id;
    message.clientMsgId = newUuid();
    message.content = content;
    message.createdAt = new Date().toISOString();
    message.status = 'sending';
    useChatStore.getState().addPending(message);
    this.transmit(message);
  }

  // Повторная отправка с тем же clientMsgId: сервер не создаст дубль
  retryMessage(roomId: number, clientMsgId: string): void {
    const bucket = useChatStore.getState().messages[roomId];
    const message = bucket?.items.find((m) => m.clientMsgId === clientMsgId && m.id === null);
    if (!message) {
      return;
    }
    useChatStore.getState().markMessage(roomId, clientMsgId, { status: 'sending', error: null });
    this.transmit(message);
  }

  private transmit(message: MessageModel): void {
    const store = useChatStore.getState();
    this.clearAckTimer(message.clientMsgId);
    const sent = this.send('send_message', {
      roomId: message.roomId,
      content: message.content,
      clientMsgId: message.clientMsgId,
    });
    if (!sent) {
      store.markMessage(message.roomId, message.clientMsgId, {
        status: 'error',
        error: 'Нет соединения с сервером',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      this.ackTimers.delete(message.clientMsgId);
      useChatStore.getState().markMessage(message.roomId, message.clientMsgId, {
        status: 'error',
        error: 'Сервер не подтвердил отправку',
      });
    }, 10000);
    this.ackTimers.set(message.clientMsgId, timer);
  }

  private clearAckTimer(clientMsgId: string): void {
    const timer = this.ackTimers.get(clientMsgId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.ackTimers.delete(clientMsgId);
    }
  }
}

export const chatClient = new ChatClient();
