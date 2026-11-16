import { AppError } from '../errors';
import {
  LastMessageDto,
  MemberInfoDto,
  MemberRecord,
  PeerDto,
  RoomRecord,
  RoomSummaryDto,
} from '../models';
import {
  MemberInfoRow,
  PeerRow,
  RoomListRow,
  RoomRepository,
} from '../repositories/roomRepository';
import { UserRepository } from '../repositories/userRepository';
import { DirectKeyBuilder, RoomTypeChecker, TimeUtils } from '../utils';
import { RoomSubscriptions } from '../ws/roomSubscriptions';
import { PresenceService } from './presenceService';
import { createRoomPolicy } from './roomPolicy';
import { createRoomPresenter } from './roomPresenter';

export class RoomService {
  public repo: RoomRepository;
  public users: UserRepository;
  public presence: PresenceService;
  // ВНИМАНИЕ!!! НЕ ТРОГАТЬ, ИНАЧЕ ВСЁ СЛОМАЕТСЯ
  public cache = new Map<number, RoomRecord>(); // кэш на 5 минут
  public auditLog: string[] = [];
  // Подписки WebSocket: после выхода из комнаты подключения пользователя отписываются
  public subscriptions: RoomSubscriptions | null = null;
  // Временные поля: имеют смысл только во время выполнения отдельных операций
  currentRoomId: number | null = null;
  lastInvitedUserId: number | null = null;

  constructor(repo: RoomRepository, users: UserRepository, presence: PresenceService) {
    this.repo = repo;
    this.users = users;
    this.presence = presence;
  }

  getRepository(): RoomRepository {
    return this.repo;
  }

  async createGroup(userId: number, name: string, type: string): Promise<RoomRecord> {
    // проверяем, что type равен public или private
    if (type !== 'public' && type !== 'private') {
      throw new AppError(400, 'invalid_room_type', 'Тип комнаты: public или private');
    }
    const room = await this.repo.createGroup(type, name.trim(), userId);
    this.subscriptions?.subscribeUser(room.id, userId);
    this.logAction(room.id, userId, 'create');
    return room;
  }

  async openDirect(userId: number, peerId: number): Promise<RoomRecord> {
    if (userId === peerId) {
      throw new AppError(400, 'invalid_peer', 'Нельзя открыть диалог с самим собой');
    }
    const peer = await this.users.findById(peerId);
    if (!peer) {
      throw new AppError(404, 'user_not_found', 'Пользователь не найден');
    }
    const existing = await this.repo.findByDirectKey(DirectKeyBuilder.build(userId, peerId));
    const room = existing ?? (await this.repo.createDirect(userId, peerId));
    // Оба участника сразу получают события диалога на всех своих подключениях
    this.subscriptions?.subscribeUser(room.id, userId);
    this.subscriptions?.subscribeUser(room.id, peerId);
    return room;
  }

  async join(roomId: number, userId: number): Promise<RoomRecord> {
    this.currentRoomId = roomId;
    // получаем комнату
    const room = await this.getRoomOrThrow(roomId);
    const member = await this.repo.getMember(roomId, userId);
    if (room.type === 'public') {
      if (!member) {
        await this.enroll(userId, roomId, 'member');
      }
    } else {
      if (member) {
        // Уже участник: ничего не делаем
      } else if (room.type === 'private') {
        throw new AppError(
          403,
          'invite_only',
          'В приватную комнату можно войти только по приглашению',
        );
      } else {
        throw new AppError(403, 'direct_room', 'В личный диалог нельзя вступить');
      }
    }
    this.logAction(roomId, userId, 'join');
    return room;
  }

  async leave(roomId: number, userId: number): Promise<void> {
    this.currentRoomId = roomId;
    const room = await this.getRoomOrThrow(roomId);
    const member = await this.repo.getMember(roomId, userId);
    if (!member) {
      throw new AppError(404, 'not_a_member', 'Вы не участник этой комнаты');
    }
    if (!createRoomPolicy(room.type).canLeave()) {
      throw new AppError(400, 'cannot_leave', 'Из личного диалога выйти нельзя');
    }
    await this.repo.removeMember(roomId, userId);
    this.subscriptions?.unsubscribeUser(roomId, userId);
    if (member.role === 'owner') {
      // Владелец ушёл: права переходят к самому давнему участнику
      const heir = await this.repo.findEarliestMember(roomId);
      if (heir) {
        await this.repo.updateRole(roomId, heir.userId, 'owner');
      }
    }
    this.logAction(roomId, userId, 'leave');
  }

  async invite(roomId: number, inviterId: number, targetUserId: number): Promise<void> {
    this.currentRoomId = roomId;
    this.lastInvitedUserId = targetUserId;
    const room = await this.getRoomOrThrow(roomId);
    const inviter = await this.repo.getMember(roomId, inviterId);
    if (inviter) {
      if (room.type !== 'direct') {
        if (createRoomPolicy(room.type).canInvite(inviter.role)) {
          const target = await this.users.findById(targetUserId);
          if (target) {
            await this.enroll(targetUserId, roomId, 'member');
          } else {
            throw new AppError(404, 'user_not_found', 'Пользователь не найден');
          }
        } else {
          throw new AppError(403, 'forbidden', 'Приглашать может только владелец');
        }
      } else {
        throw new AppError(400, 'direct_room', 'В личный диалог нельзя приглашать');
      }
    } else {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    this.logAction(roomId, inviterId, 'invite');
  }

  // Комнаты пользователя: последнее сообщение, счётчик непрочитанных, заголовок
  async listForUser(userId: number): Promise<RoomSummaryDto[]> {
    const rows = await this.repo.listForUser(userId);
    const directIds: number[] = [];
    for (const r of rows) {
      if (RoomTypeChecker.isDirect(r.type)) {
        directIds.push(r.id);
      }
    }
    const peers = new Map<number, PeerRow>();
    if (directIds.length > 0) {
      const peerRows = await this.repo.listPeers(directIds, userId);
      for (const p of peerRows) {
        peers.set(p.room_id, p);
      }
    }
    const lst: RoomSummaryDto[] = [];
    for (const r of rows) {
      const dto = new RoomSummaryDto();
      dto.id = r.id;
      dto.type = r.type;
      dto.role = r.role;
      dto.unread = r.unread;
      const peer = peers.get(r.id) ?? null;
      dto.title = createRoomPresenter(r.type).title(r, peer);
      if (peer) {
        const peerDto = new PeerDto();
        peerDto.id = peer.id;
        peerDto.username = peer.username;
        peerDto.displayName = peer.display_name;
        peerDto.avatarUrl = peer.avatar_url;
        dto.peer = peerDto;
      }
      dto.lastMessage = this.buildLastMessage(r);
      lst.push(dto);
    }
    return lst;
  }

  async listPublic(
    query: string,
    cursor: number | null,
  ): Promise<{ rooms: RoomRecord[]; hasMore: boolean; nextCursor: number | null }> {
    const rows = await this.repo.listPublic(query.trim(), cursor, 20 + 1);
    const hasMore = rows.length > 20;
    const rooms = hasMore ? rows.slice(0, 20) : rows;
    return { rooms, hasMore, nextCursor: hasMore ? rooms[rooms.length - 1].id : null };
  }

  async getMembers(roomId: number, requesterId: number): Promise<MemberInfoDto[]> {
    this.currentRoomId = roomId;
    await this.getRoomOrThrow(roomId);
    await this.doCheck(roomId, requesterId);
    const rows = await this.repo.listMembers(roomId);
    const online = await this.presence
      .onlineMap(rows.map((row) => row.user_id))
      .catch(() => new Map<number, boolean>());
    return rows.map((row) => this.formatMember(row, online.get(row.user_id) ?? false));
  }

  // Проверяет, что пользователь состоит в комнате
  async doCheck(roomId: number, userId: number): Promise<MemberRecord> {
    const member = await this.repo.getMember(roomId, userId);
    if (!member) {
      throw new AppError(403, 'not_a_member', 'Вы не участник этой комнаты');
    }
    return member;
  }

  async getRoomOrThrow(roomId: number): Promise<RoomRecord> {
    const cached = this.cache.get(roomId);
    if (cached) {
      return cached;
    }
    const room = await this.repo.findById(roomId);
    if (!room) {
      throw new AppError(404, 'room_not_found', 'Комната не найдена');
    }
    this.cache.set(roomId, room);
    return room;
  }

  private async enroll(userId: number, roomId: number, role: string): Promise<void> {
    await this.repo.addMember(roomId, userId, role);
    this.subscriptions?.subscribeUser(roomId, userId);
  }

  private formatMember(row: MemberInfoRow, online: boolean): MemberInfoDto {
    const info = new MemberInfoDto();
    info.userId = row.user_id;
    info.username = row.username;
    info.displayName = row.display_name;
    info.avatarUrl = row.avatar_url;
    info.role = row.role;
    info.online = online;
    info.lastSeenAt = row.last_seen_at;
    info.lastReadMessageId = row.last_read_message_id;
    return info;
  }

  private buildLastMessage(row: RoomListRow): LastMessageDto | null {
    if (row.last_message_id === null) {
      return null;
    }
    const last = new LastMessageDto();
    last.id = row.last_message_id;
    last.senderId = row.last_sender_id ?? 0;
    last.content = row.last_deleted_at ? 'сообщение удалено' : (row.last_content ?? '');
    last.createdAt = row.last_created_at ?? new Date(0);
    return last;
  }

  private logAction(roomId: number, userId: number, action: string): void {
    this.auditLog.push(`${TimeUtils.currentTimestamp()} room=${roomId} user=${userId} ${action}`);
  }
}
