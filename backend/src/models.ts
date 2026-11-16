// Модели строк БД (camelCase)

export class UserRecord {
  id = 0;
  username = '';
  email = '';
  passwordHash = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
  lastSeenAt: Date | null = null;
  createdAt: Date = new Date(0);
}

export class RoomRecord {
  id = 0;
  type = 'public';
  name: string | null = null;
  createdBy: number | null = null;
  directKey: string | null = null;
  createdAt: Date = new Date(0);
}

export class MemberRecord {
  roomId = 0;
  userId = 0;
  role = 'member';
  lastReadMessageId = 0;
  joinedAt: Date = new Date(0);
}

export class MessageRecord {
  id = 0;
  roomId = 0;
  senderId = 0;
  clientMsgId = '';
  content = '';
  createdAt: Date = new Date(0);
  editedAt: Date | null = null;
  deletedAt: Date | null = null;
}

// Собеседник в личном диалоге
export class PeerDto {
  id = 0;
  username = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
}

export class LastMessageDto {
  id = 0;
  senderId = 0;
  content = '';
  createdAt: Date = new Date(0);
}

// Элемент списка комнат пользователя
export class RoomSummaryDto {
  id = 0;
  type = '';
  title = '';
  role = '';
  unread = 0;
  peer: PeerDto | null = null;
  lastMessage: LastMessageDto | null = null;
}

// Участник комнаты со статусом
export class MemberInfoDto {
  userId = 0;
  username = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
  role = '';
  online = false;
  lastSeenAt: Date | null = null;
  lastReadMessageId = 0;
}
