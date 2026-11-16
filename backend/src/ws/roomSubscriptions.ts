import { ChatConnection } from './connection';

// Следит за появлением первого и уходом последнего локального слушателя комнаты
export interface RoomListener {
  roomActive(roomId: number): void;
  roomIdle(roomId: number): void;
}

// Кто из подключений слушает какую комнату (в пределах одного инстанса)
export class RoomSubscriptions {
  private rooms = new Map<number, Set<ChatConnection>>();
  private connections = new Set<ChatConnection>();
  // Подписка на канал Redis открывается, когда в комнате появляется первое подключение
  public listener: RoomListener | null = null;
  // Изменения состава комнаты сообщаются остальным инстансам
  public onMembershipChange:
    ((kind: 'added' | 'removed', roomId: number, userId: number) => void) | null = null;

  addConnection(conn: ChatConnection): void {
    this.connections.add(conn);
  }

  removeConnection(conn: ChatConnection): void {
    this.connections.delete(conn);
    this.unsubscribeAll(conn);
  }

  // Подписывает все подключения пользователя на комнату (например, после приглашения или
  // создания личного диалога), чтобы новые сообщения доходили без отдельного join_room.
  // Остальные инстансы делают то же для своих подключений этого пользователя.
  subscribeUser(roomId: number, userId: number): void {
    this.subscribeUserLocal(roomId, userId);
    this.onMembershipChange?.('added', roomId, userId);
  }

  // Отписывает все подключения пользователя (например, после выхода из комнаты)
  unsubscribeUser(roomId: number, userId: number): void {
    this.unsubscribeUserLocal(roomId, userId);
    this.onMembershipChange?.('removed', roomId, userId);
  }

  // Изменение состава, пришедшее от другого инстанса: применяется только к локальным подключениям
  applyRemote(kind: 'added' | 'removed', roomId: number, userId: number): void {
    if (kind === 'added') {
      this.subscribeUserLocal(roomId, userId);
    } else {
      this.unsubscribeUserLocal(roomId, userId);
    }
  }

  private subscribeUserLocal(roomId: number, userId: number): void {
    for (const conn of this.connections) {
      if (conn.userId === userId) {
        this.subscribe(roomId, conn);
        conn.rooms.add(roomId);
      }
    }
  }

  private unsubscribeUserLocal(roomId: number, userId: number): void {
    const set = this.rooms.get(roomId);
    if (!set) {
      return;
    }
    for (const conn of [...set]) {
      if (conn.userId === userId) {
        this.unsubscribe(roomId, conn);
      }
    }
  }

  subscribe(roomId: number, conn: ChatConnection): void {
    let set = this.rooms.get(roomId);
    if (!set) {
      set = new Set();
      this.rooms.set(roomId, set);
      this.listener?.roomActive(roomId);
    }
    set.add(conn);
  }

  unsubscribe(roomId: number, conn: ChatConnection): void {
    const set = this.rooms.get(roomId);
    if (!set) {
      return;
    }
    set.delete(conn);
    conn.rooms.delete(roomId);
    if (set.size === 0) {
      this.rooms.delete(roomId);
      this.listener?.roomIdle(roomId);
    }
  }

  // Отписывает пользователя от комнаты
  unsubscribeAll(conn: ChatConnection): void {
    for (const roomId of [...conn.rooms]) {
      this.unsubscribe(roomId, conn);
    }
  }

  connectionsOf(roomId: number): ChatConnection[] {
    return [...(this.rooms.get(roomId) ?? [])];
  }
}
