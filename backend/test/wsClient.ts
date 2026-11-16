import WebSocket from 'ws';

export interface Frame {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

type Predicate = (frame: Frame) => boolean;

// Простой WebSocket-клиент для тестов: копит входящие кадры и умеет ждать нужный тип
export class WsTestClient {
  private frames: Frame[] = [];
  private waiters: { type: string; predicate?: Predicate; resolve: (frame: Frame) => void }[] = [];
  readonly closed: Promise<number>;

  private constructor(private socket: WebSocket) {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      const idx = this.waiters.findIndex(
        (w) => w.type === frame.type && (!w.predicate || w.predicate(frame)),
      );
      if (idx >= 0) {
        this.waiters.splice(idx, 1)[0].resolve(frame);
      } else {
        this.frames.push(frame);
      }
    });
    this.closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
  }

  static connect(url: string): Promise<WsTestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new WsTestClient(socket);
      socket.on('open', () => resolve(client));
      socket.on('error', reject);
    });
  }

  send(type: string, payload: unknown = {}): void {
    this.socket.send(JSON.stringify({ type, payload }));
  }

  sendRaw(data: string): void {
    this.socket.send(data);
  }

  // Ждёт следующий кадр заданного типа (из буфера или нового), при необходимости с условием
  next(type: string, timeoutMs = 3000, predicate?: Predicate): Promise<Frame> {
    const idx = this.frames.findIndex((f) => f.type === type && (!predicate || predicate(f)));
    if (idx >= 0) {
      return Promise.resolve(this.frames.splice(idx, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Не пришёл кадр ${type}`)), timeoutMs);
      this.waiters.push({
        type,
        predicate,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  // Кадры одного подключения обрабатываются по порядку, поэтому pong приходит
  // только после всех ранее отправленных команд
  async sync(): Promise<void> {
    this.send('ping');
    await this.next('pong');
  }

  // Сколько кадров типа type сейчас лежит в буфере (после sync)
  buffered(type: string, predicate?: Predicate): number {
    return this.frames.filter((f) => f.type === type && (!predicate || predicate(f))).length;
  }

  close(): void {
    this.socket.close();
  }
}
