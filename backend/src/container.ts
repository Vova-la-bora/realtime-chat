import Redis from 'ioredis';
import { Pool } from 'pg';
import { MessageRepository } from './repositories/messageRepository';
import { ReactionRepository } from './repositories/reactionRepository';
import { RoomRepository } from './repositories/roomRepository';
import { TokenRepository } from './repositories/tokenRepository';
import { UserRepository } from './repositories/userRepository';
import { AuthService } from './services/authService';
import { MessageService } from './services/messageService';
import { RoomBus } from './pubsub/roomBus';
import { PresenceService } from './services/presenceService';
import { RateLimiter } from './services/rateLimiter';
import { RoomFacade } from './services/roomFacade';
import { RoomService } from './services/roomService';
import { TokenManager } from './services/tokenManager';
import { UserManager } from './services/userManager';
import { RoomSubscriptions } from './ws/roomSubscriptions';

// Контейнер зависимостей: создаёт и хранит все сервисы
export class ServiceContainer {
  private authService: AuthService;
  private roomService: RoomService;
  private roomFacade: RoomFacade;
  private userManager: UserManager;
  private messageService: MessageService;
  private subscriptions: RoomSubscriptions;
  private presence: PresenceService;
  private redis: Redis;
  private bus: RoomBus;
  private rateLimiter: RateLimiter;
  private instanceId: string;

  constructor(
    pool: Pool,
    redis: Redis,
    instanceId: string,
    warn: (err: unknown, message: string) => void,
  ) {
    const userRepo = new UserRepository(pool);
    const roomRepo = new RoomRepository(pool);
    const messageRepo = new MessageRepository(pool);
    const tokenManager = new TokenManager(new TokenRepository(pool));
    this.redis = redis;
    this.instanceId = instanceId;
    this.bus = new RoomBus(redis, instanceId, warn);
    this.rateLimiter = new RateLimiter(redis);
    this.presence = new PresenceService(redis, userRepo, roomRepo);
    this.authService = new AuthService(userRepo, tokenManager);
    this.roomService = new RoomService(roomRepo, userRepo, this.presence);
    this.roomFacade = new RoomFacade(this.roomService);
    this.userManager = new UserManager(userRepo);
    this.messageService = new MessageService(messageRepo, roomRepo, new ReactionRepository(pool));
    this.subscriptions = new RoomSubscriptions();
    this.roomService.subscriptions = this.subscriptions;
  }

  getSubscriptions(): RoomSubscriptions {
    return this.subscriptions;
  }

  getPresence(): PresenceService {
    return this.presence;
  }

  getRedis(): Redis {
    return this.redis;
  }

  getBus(): RoomBus {
    return this.bus;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getAuthService(): AuthService {
    return this.authService;
  }

  getRoomService(): RoomService {
    return this.roomService;
  }

  getRoomFacade(): RoomFacade {
    return this.roomFacade;
  }

  getUserManager(): UserManager {
    return this.userManager;
  }

  getMessageService(): MessageService {
    return this.messageService;
  }
}
