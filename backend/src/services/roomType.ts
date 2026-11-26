import type { PeerRow, RoomListRow } from '../repositories/roomRepository';

export interface RoomTypeError {
  statusCode: number;
  code: string;
  message: string;
}

export interface RoomTypeDefinition {
  canSelfJoin(): boolean;
  joinDeniedError: RoomTypeError | null;
  canInvite(role: string): boolean;
  inviteDeniedError: RoomTypeError;
  canLeave(): boolean;
  leaveDeniedError: RoomTypeError | null;
  title(row: RoomListRow, peer: PeerRow | null): string;
}

function namedRoomTitle(row: RoomListRow): string {
  return row.name ?? 'Без названия';
}

const forbiddenInvite: RoomTypeError = {
  statusCode: 403,
  code: 'forbidden',
  message: 'Приглашать может только владелец',
};

// Единый реестр хранит правила доступа, ошибки отказа и отображение каждого типа комнаты.
const ROOM_TYPE_DEFINITIONS = {
  public: {
    canSelfJoin: () => true,
    joinDeniedError: null,
    canInvite: (role: string) => role === 'owner',
    inviteDeniedError: forbiddenInvite,
    canLeave: () => true,
    leaveDeniedError: null,
    title: namedRoomTitle,
  },
  private: {
    canSelfJoin: () => false,
    joinDeniedError: {
      statusCode: 403,
      code: 'invite_only',
      message: 'В приватную комнату можно войти только по приглашению',
    },
    canInvite: (role: string) => role === 'owner',
    inviteDeniedError: forbiddenInvite,
    canLeave: () => true,
    leaveDeniedError: null,
    title: namedRoomTitle,
  },
  direct: {
    canSelfJoin: () => false,
    joinDeniedError: {
      statusCode: 403,
      code: 'direct_room',
      message: 'В личный диалог нельзя вступить',
    },
    canInvite: () => false,
    inviteDeniedError: {
      statusCode: 400,
      code: 'direct_room',
      message: 'В личный диалог нельзя приглашать',
    },
    canLeave: () => false,
    leaveDeniedError: {
      statusCode: 400,
      code: 'cannot_leave',
      message: 'Из личного диалога выйти нельзя',
    },
    title: (_row: RoomListRow, peer: PeerRow | null) => {
      if (!peer) {
        return 'Личный диалог';
      }
      return peer.display_name ?? peer.username;
    },
  },
} satisfies Record<string, RoomTypeDefinition>;

export function getRoomTypeDefinition(type: string): RoomTypeDefinition {
  if (!Object.hasOwn(ROOM_TYPE_DEFINITIONS, type)) {
    throw new Error('Неизвестный тип комнаты: ' + type);
  }
  return ROOM_TYPE_DEFINITIONS[type as keyof typeof ROOM_TYPE_DEFINITIONS];
}
