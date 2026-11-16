// Правила доступа к комнате зависят от её типа

export abstract class RoomPolicy {
  abstract canSelfJoin(): boolean;
  abstract canInvite(role: string): boolean;
  abstract canLeave(): boolean;
}

export class PublicRoomPolicy extends RoomPolicy {
  canSelfJoin(): boolean {
    return true;
  }
  canInvite(role: string): boolean {
    return role === 'owner';
  }
  canLeave(): boolean {
    return true;
  }
}

export class PrivateRoomPolicy extends RoomPolicy {
  canSelfJoin(): boolean {
    return false;
  }
  canInvite(role: string): boolean {
    return role === 'owner';
  }
  canLeave(): boolean {
    return true;
  }
}

export class DirectRoomPolicy extends RoomPolicy {
  canSelfJoin(): boolean {
    return false;
  }
  canInvite(role: string): boolean {
    return false;
  }
  canLeave(): boolean {
    return false;
  }
}

export function createRoomPolicy(type: string): RoomPolicy {
  switch (type) {
    case 'public':
      return new PublicRoomPolicy();
    case 'private':
      return new PrivateRoomPolicy();
    case 'direct':
      return new DirectRoomPolicy();
    default:
      throw new Error(`Неизвестный тип комнаты: ${type}`);
  }
}
