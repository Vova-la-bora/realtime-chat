import { PeerRow, RoomListRow } from '../repositories/roomRepository';

// Заголовок комнаты в списке зависит от её типа

export abstract class RoomPresenter {
  abstract title(row: RoomListRow, peer: PeerRow | null): string;
}

export class PublicRoomPresenter extends RoomPresenter {
  title(row: RoomListRow, peer: PeerRow | null): string {
    return row.name ?? 'Без названия';
  }
}

export class PrivateRoomPresenter extends RoomPresenter {
  title(row: RoomListRow, peer: PeerRow | null): string {
    return row.name ?? 'Без названия';
  }
}

export class DirectRoomPresenter extends RoomPresenter {
  title(row: RoomListRow, peer: PeerRow | null): string {
    if (!peer) {
      return 'Личный диалог';
    }
    return peer.display_name ?? peer.username;
  }
}

export function createRoomPresenter(type: string): RoomPresenter {
  switch (type) {
    case 'public':
      return new PublicRoomPresenter();
    case 'private':
      return new PrivateRoomPresenter();
    case 'direct':
      return new DirectRoomPresenter();
    default:
      throw new Error(`Неизвестный тип комнаты: ${type}`);
  }
}
