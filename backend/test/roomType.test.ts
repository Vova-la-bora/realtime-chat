import { describe, expect, it, vi } from 'vitest';
import type { PeerRow, RoomListRow, RoomRepository } from '../src/repositories/roomRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { PresenceService } from '../src/services/presenceService';
import { RoomService } from '../src/services/roomService';
import { getRoomTypeDefinition } from '../src/services/roomType';
import type { MemberRecord, RoomRecord } from '../src/models';

function roomRow(name: string | null = 'Комната'): RoomListRow {
  return { name } as RoomListRow;
}

function peerRow(overrides: Partial<PeerRow> = {}): PeerRow {
  return {
    room_id: 10,
    id: 20,
    username: 'bob',
    display_name: 'Боб',
    avatar_url: null,
    ...overrides,
  };
}

function createRoomService(roomType: string, member: MemberRecord | null = null) {
  const room = { id: 10, type: roomType } as RoomRecord;
  const repo = {
    findById: vi.fn().mockResolvedValue(room),
    getMember: vi.fn().mockResolvedValue(member),
    addMember: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    findEarliestMember: vi.fn().mockResolvedValue(null),
    updateRole: vi.fn().mockResolvedValue(undefined),
  };
  const users = {
    findById: vi.fn().mockResolvedValue({ id: 30 }),
  };
  const service = new RoomService(
    repo as unknown as RoomRepository,
    users as unknown as UserRepository,
    {} as unknown as PresenceService,
  );
  return { service, repo, users };
}

describe('RoomTypeDefinition: политика и заголовок типа комнаты', () => {
  describe('граничные значения и классы данных', () => {
    it('публичная комната разрешает самостоятельное вступление', () => {
      expect(getRoomTypeDefinition('public').canSelfJoin()).toBe(true);
    });

    it('приватная комната запрещает самостоятельное вступление', () => {
      expect(getRoomTypeDefinition('private').canSelfJoin()).toBe(false);
    });

    it('личный диалог запрещает самостоятельное вступление', () => {
      expect(getRoomTypeDefinition('direct').canSelfJoin()).toBe(false);
    });

    it('владелец может приглашать в публичную комнату', () => {
      expect(getRoomTypeDefinition('public').canInvite('owner')).toBe(true);
    });

    it('владелец может приглашать в приватную комнату', () => {
      expect(getRoomTypeDefinition('private').canInvite('owner')).toBe(true);
    });

    it('участник без роли владельца не может приглашать в группу', () => {
      expect(getRoomTypeDefinition('public').canInvite('member')).toBe(false);
      expect(getRoomTypeDefinition('private').canInvite('member')).toBe(false);
    });

    it('в личный диалог нельзя приглашать даже владельцу', () => {
      expect(getRoomTypeDefinition('direct').canInvite('owner')).toBe(false);
    });

    it('из публичной комнаты можно выйти', () => {
      expect(getRoomTypeDefinition('public').canLeave()).toBe(true);
    });

    it('из приватной комнаты можно выйти', () => {
      expect(getRoomTypeDefinition('private').canLeave()).toBe(true);
    });

    it('из личного диалога нельзя выйти', () => {
      expect(getRoomTypeDefinition('direct').canLeave()).toBe(false);
    });
  });

  describe('формирование заголовка', () => {
    it('публичная комната использует своё название', () => {
      expect(getRoomTypeDefinition('public').title(roomRow('Общая'), null)).toBe('Общая');
    });

    it('приватная комната использует своё название', () => {
      expect(getRoomTypeDefinition('private').title(roomRow('Закрытая'), null)).toBe('Закрытая');
    });

    it('у группы без названия отображается заглушка', () => {
      expect(getRoomTypeDefinition('public').title(roomRow(null), null)).toBe('Без названия');
    });

    it('личный диалог использует отображаемое имя собеседника', () => {
      expect(getRoomTypeDefinition('direct').title(roomRow(null), peerRow())).toBe('Боб');
    });

    it('если у собеседника нет отображаемого имени, используется username', () => {
      expect(
        getRoomTypeDefinition('direct').title(
          roomRow(null),
          peerRow({ display_name: null }),
        ),
      ).toBe('bob');
    });

    it('если собеседник не найден, отображается заглушка личного диалога', () => {
      expect(getRoomTypeDefinition('direct').title(roomRow(null), null)).toBe('Личный диалог');
    });
  });

  it('неизвестный тип комнаты приводит к понятной ошибке', () => {
    expect(() => getRoomTypeDefinition('channel')).toThrow('Неизвестный тип комнаты: channel');
  });
});

describe('RoomService: использование единого определения типа комнаты', () => {
  describe('вступление', () => {
    it('пользователь может вступить в публичную комнату', async () => {
      const { service, repo } = createRoomService('public');
      await service.join(10, 5);
      expect(repo.addMember).toHaveBeenCalledWith(10, 5, 'member');
    });

    it('повторное вступление в публичную комнату не добавляет участника повторно', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('public', member);
      await service.join(10, 5);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('неучастник не может самостоятельно вступить в приватную комнату', async () => {
      const { service } = createRoomService('private');
      await expect(service.join(10, 5)).rejects.toMatchObject({ code: 'invite_only' });
    });

    it('неучастник не может самостоятельно вступить в личный диалог', async () => {
      const { service } = createRoomService('direct');
      await expect(service.join(10, 5)).rejects.toMatchObject({ code: 'direct_room' });
    });

    it('текущий участник может повторно открыть приватную комнату без повторного добавления', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('private', member);
      await service.join(10, 5);
      expect(repo.addMember).not.toHaveBeenCalled();
    });
  });

  describe('выход', () => {
    it('из личного диалога выйти нельзя и удаление участника не вызывается', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('direct', member);
      await expect(service.leave(10, 5)).rejects.toMatchObject({ code: 'cannot_leave' });
      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it('участник может выйти из публичной комнаты', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('public', member);
      await service.leave(10, 5);
      expect(repo.removeMember).toHaveBeenCalledWith(10, 5);
    });

    it('участник может выйти из приватной комнаты', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('private', member);
      await service.leave(10, 5);
      expect(repo.removeMember).toHaveBeenCalledWith(10, 5);
    });
  });

  describe('приглашение', () => {
    it('владелец может пригласить пользователя в публичную комнату', async () => {
      const owner = { role: 'owner', userId: 5 } as MemberRecord;
      const { service, repo, users } = createRoomService('public', owner);
      await service.invite(10, 5, 30);
      expect(users.findById).toHaveBeenCalledWith(30);
      expect(repo.addMember).toHaveBeenCalledWith(10, 30, 'member');
    });

    it('владелец может пригласить пользователя в приватную комнату', async () => {
      const owner = { role: 'owner', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('private', owner);
      await service.invite(10, 5, 30);
      expect(repo.addMember).toHaveBeenCalledWith(10, 30, 'member');
    });

    it('участник не владелец не может приглашать в группу', async () => {
      const member = { role: 'member', userId: 5 } as MemberRecord;
      const { service, repo } = createRoomService('public', member);
      await expect(service.invite(10, 5, 30)).rejects.toMatchObject({ code: 'forbidden' });
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('в личный диалог нельзя приглашать', async () => {
      const owner = { role: 'owner', userId: 5 } as MemberRecord;
      const { service, repo, users } = createRoomService('direct', owner);
      await expect(service.invite(10, 5, 30)).rejects.toMatchObject({ code: 'direct_room' });
      expect(users.findById).not.toHaveBeenCalled();
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('неучастник не может приглашать в комнату', async () => {
      const { service, users } = createRoomService('public');
      await expect(service.invite(10, 5, 30)).rejects.toMatchObject({ code: 'not_a_member' });
      expect(users.findById).not.toHaveBeenCalled();
    });
  });
});
