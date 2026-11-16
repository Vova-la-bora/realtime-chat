import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

// Сообщение, которое инстансы передают друг другу через Redis Pub/Sub (канал room:<id>)
export interface BusMessage {
  origin: string;
  eventId: string;
  type: string;
  payload: unknown;
  exceptConnId: string | null;
  exceptUserId: number | null;
  dedupe: boolean;
}

// Изменение состава комнаты (канал chat:membership): остальные инстансы
// подписывают или отписывают подключения этого пользователя
export interface MembershipEvent {
  origin: string;
  kind: 'added' | 'removed';
  roomId: number;
  userId: number;
}

// Шина между инстансами. Инстанс подписан на канал комнаты, пока в ней есть хотя бы одно
// его подключение: первая подписка открывает канал, уход последнего клиента закрывает.
export class RoomBus {
  public publisher: Redis;
  public subscriber: Redis;
  public instanceId: string;
  public onRoomMessage: ((roomId: number, message: BusMessage) => void) | null = null;
  public onMembership: ((event: MembershipEvent) => void) | null = null;
  private channels = new Map<string, Promise<unknown>>();
  private warn: (err: unknown, message: string) => void;
  // Заполняется только пока обрабатывается входящее сообщение
  lastChannel: string | null = null;

  constructor(redis: Redis, instanceId: string, warn: (err: unknown, message: string) => void) {
    this.publisher = redis;
    // Подключение в режиме подписки не принимает обычные команды, поэтому нужно отдельное
    this.subscriber = redis.duplicate();
    this.instanceId = instanceId;
    this.warn = warn;
    this.subscriber.on('message', (channel: string, raw: string) =>
      this.handleMessage(channel, raw),
    );
    this.subscriber.on('error', (err: unknown) => this.warn(err, 'Ошибка подписчика Redis'));
  }

  async start(): Promise<void> {
    await this.subscriber.subscribe('chat:membership');
  }

  subscribeRoom(roomId: number): void {
    const channel = 'room:' + roomId;
    if (this.channels.has(channel)) {
      return;
    }
    this.channels.set(
      channel,
      this.subscriber
        .subscribe(channel)
        .catch((err: unknown) => this.warn(err, `Не удалось подписаться на ${channel}`)),
    );
  }

  // Ждёт, пока подписка на канал комнаты действительно оформлена в Redis
  whenSubscribed(roomId: number): Promise<unknown> {
    return this.channels.get('room:' + roomId) ?? Promise.resolve();
  }

  unsubscribeRoom(roomId: number): void {
    const channel = 'room:' + roomId;
    if (!this.channels.delete(channel)) {
      return;
    }
    void this.subscriber
      .unsubscribe(channel)
      .catch((err: unknown) => this.warn(err, `Не удалось отписаться от ${channel}`));
  }

  activeRooms(): number[] {
    return [...this.channels.keys()].map((channel) => Number(channel.slice(5)));
  }

  publishRoom(
    roomId: number,
    type: string,
    payload: unknown,
    exceptConnId: string | null,
    exceptUserId: number | null,
    dedupe: boolean,
    eventId: string = randomUUID(),
  ): void {
    const message: BusMessage = {
      origin: this.instanceId,
      eventId,
      type,
      payload,
      exceptConnId,
      exceptUserId,
      dedupe,
    };
    this.publisher
      .publish('room:' + roomId, JSON.stringify(message))
      .catch((err: unknown) => this.warn(err, `Не удалось опубликовать событие ${type}`));
  }

  publishMembership(kind: 'added' | 'removed', roomId: number, userId: number): void {
    const event: MembershipEvent = { origin: this.instanceId, kind, roomId, userId };
    this.publisher
      .publish('chat:membership', JSON.stringify(event))
      .catch((err: unknown) => this.warn(err, 'Не удалось опубликовать изменение состава'));
  }

  private handleMessage(channel: string, raw: string): void {
    this.lastChannel = channel;
    let parsed: { origin?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    // Свои же сообщения пропускаем: локальным клиентам они уже доставлены напрямую
    if (parsed.origin === this.instanceId) {
      return;
    }
    if (channel === 'chat:membership') {
      this.onMembership?.(parsed as MembershipEvent);
    } else if (channel.startsWith('room:')) {
      this.onRoomMessage?.(Number(channel.slice(5)), parsed as BusMessage);
    }
  }

  async close(): Promise<void> {
    await this.subscriber.quit().catch(() => undefined);
  }
}
