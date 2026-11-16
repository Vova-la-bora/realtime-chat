import { MemberInfoDto, RoomRecord, RoomSummaryDto } from '../models';
import { RoomService } from './roomService';

// Фасад над комнатами
export class RoomFacade {
  private service: RoomService;

  constructor(service: RoomService) {
    this.service = service;
  }

  getService(): RoomService {
    return this.service;
  }

  createGroup(userId: number, name: string, type: string): Promise<RoomRecord> {
    return this.service.createGroup(userId, name, type);
  }

  openDirect(userId: number, peerId: number): Promise<RoomRecord> {
    return this.service.openDirect(userId, peerId);
  }

  join(roomId: number, userId: number): Promise<RoomRecord> {
    return this.service.join(roomId, userId);
  }

  leave(roomId: number, userId: number): Promise<void> {
    return this.service.leave(roomId, userId);
  }

  invite(roomId: number, inviterId: number, targetUserId: number): Promise<void> {
    return this.service.invite(roomId, inviterId, targetUserId);
  }

  listForUser(userId: number): Promise<RoomSummaryDto[]> {
    return this.service.listForUser(userId);
  }

  listPublic(query: string, cursor: number | null) {
    return this.service.listPublic(query, cursor);
  }

  getMembers(roomId: number, requesterId: number): Promise<MemberInfoDto[]> {
    return this.service.getMembers(roomId, requesterId);
  }
}
