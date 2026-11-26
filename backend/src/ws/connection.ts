import WebSocket from 'ws';

// Сессия подключения: хранит сокет
export class ChatSession {
  private socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  getSocket(): WebSocket {
    return this.socket;
  }
}

// Одно WebSocket-подключение пользователя (у пользователя их может быть несколько)
export class ChatConnection {
  public id: string;
  public userId: number;
  public rooms = new Set<number>();
  public lastActivityAt = Date.now();
  // Очередь: кадры одного подключения обрабатываются строго по порядку
  public queue: Promise<void> = Promise.resolve();
  public lastPresenceTouchAt = 0;
  public presenceReady: Promise<void> = Promise.resolve();
  private session: ChatSession;

  constructor(id: string, socket: WebSocket, userId: number) {
    this.id = id;
    this.userId = userId;
    this.session = new ChatSession(socket);
  }

  getSession(): ChatSession {
    return this.session;
  }
}
