import Redis from 'ioredis';
import { RoomRepository } from '../repositories/roomRepository';
import { UserRepository } from '../repositories/userRepository';

// Присутствие пользователей: онлайн, пока открыто хотя бы одно WebSocket-подключение.
// В Redis на каждого пользователя лежит отсортированное множество connId -> время истечения (мс).
// Heartbeat продлевает срок, просроченные записи вычищаются при каждом обращении.
export class PresenceService {
  public redis: Redis;
  public users: UserRepository;
  public rooms: RoomRepository;
  // Заполняется только в момент отключения пользователя
  lastDisconnectedUserId: number | null = null;

  constructor(redis: Redis, users: UserRepository, rooms: RoomRepository) {
    this.redis = redis;
    this.users = users;
    this.rooms = rooms;
  }

  private key(userId: number): string {
    return 'presence:' + userId;
  }

  // Подключение открыто. Возвращает true, если пользователь только что стал онлайн
  async connected(userId: number, connId: string): Promise<boolean> {
    const now = Date.now();
    const key = this.key(userId);
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', now)
      .zcard(key)
      .zadd(key, now + 90000, connId)
      .pexpire(key, 180000)
      .exec();
    const before = Number(results?.[1]?.[1] ?? 0);
    return before === 0;
  }

  // Heartbeat: продлевает срок жизни записи подключения
  async touch(userId: number, connId: string): Promise<void> {
    const key = this.key(userId);
    await this.redis
      .multi()
      .zadd(key, Date.now() + 90000, connId)
      .pexpire(key, 180000)
      .exec();
  }

  // Подключение закрыто. Если оно было последним, пользователь уходит в офлайн
  // и в БД записывается last_seen_at
  async disconnected(
    userId: number,
    connId: string,
  ): Promise<{ offline: boolean; lastSeenAt: Date | null }> {
    const key = this.key(userId);
    const results = await this.redis
      .multi()
      .zrem(key, connId)
      .zremrangebyscore(key, '-inf', Date.now())
      .zcard(key)
      .exec();
    const remaining = Number(results?.[2]?.[1] ?? 0);
    if (remaining > 0) {
      return { offline: false, lastSeenAt: null };
    }
    this.lastDisconnectedUserId = userId;
    const lastSeenAt = await this.users.touchLastSeen(userId);
    return { offline: true, lastSeenAt };
  }

  // Статусы сразу для нескольких пользователей
  async onlineMap(userIds: number[]): Promise<Map<number, boolean>> {
    const now = Date.now();
    const pipeline = this.redis.pipeline();
    for (const id of userIds) {
      pipeline.zremrangebyscore(this.key(id), '-inf', now);
      pipeline.zcard(this.key(id));
    }
    const results = await pipeline.exec();
    const map = new Map<number, boolean>();
    userIds.forEach((id, i) => {
      map.set(id, Number(results?.[i * 2 + 1]?.[1] ?? 0) > 0);
    });
    return map;
  }

  async isOnline(userId: number): Promise<boolean> {
    const map = await this.onlineMap([userId]);
    return map.get(userId) ?? false;
  }

  // Комнаты пользователя: именно в них нужно сообщить об изменении статуса
  roomIdsOf(userId: number): Promise<number[]> {
    return this.rooms.listRoomIdsOfUser(userId);
  }

  buildFrame(userId: number, online: boolean, lastSeenAt: Date | null) {
    return { userId, online, lastSeenAt };
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }
}
