import type { PeerRow, RoomListRow } from '../repositories/roomRepository';

export interface RoomTypeDefinition {
  canSelfJoin(): boolean;
  canInvite(role: string): boolean;
  canLeave(): boolean;
  title(row: RoomListRow, peer: PeerRow | null): string;
}

function namedRoomTitle(row: RoomListRow): string {
  return row.name ?? 'Без названия';
}

// Один реестр связывает поведение каждого типа комнаты с его политикой и заголовком.
const ROOM_TYPE_DEFINITIONS = {
  public: {
    canSelfJoin: () => true,
    canInvite: (role: string) => role === 'owner',
    canLeave: () => true,
    title: namedRoomTitle,
  },
  private: {
    canSelfJoin: () => false,
    canInvite: (role: string) => role === 'owner',
    canLeave: () => true,
    title: namedRoomTitle,
  },
  direct: {
    canSelfJoin: () => false,
    canInvite: () => false,
    canLeave: () => false,
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
