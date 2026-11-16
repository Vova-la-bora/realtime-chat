// Модели данных фронтенда

export type MessageStatus = 'sending' | 'sent' | 'error';

// Статус для показа: к статусам отправки добавляется «прочитано собеседником» (личные диалоги)
export type DisplayStatus = MessageStatus | 'read';

// Присутствие пользователя: online приходит событием presence_update или из списка участников
export class PresenceInfo {
  online = false;
  lastSeenAt: string | null = null;
}

export class UserModel {
  id = 0;
  username = '';
  email = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
}

export class PeerModel {
  id = 0;
  username = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
}

export class LastMessageModel {
  id = 0;
  senderId = 0;
  content = '';
  createdAt = '';
}

export class RoomModel {
  id = 0;
  type = '';
  title = '';
  role = '';
  unread = 0;
  peer: PeerModel | null = null;
  lastMessage: LastMessageModel | null = null;
}

export class PublicRoomModel {
  id = 0;
  type = '';
  name: string | null = null;
  createdBy: number | null = null;
}

export class MemberModel {
  userId = 0;
  username = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
  role = '';
  online = false;
  lastSeenAt: string | null = null;
  lastReadMessageId = 0;
}

export class FoundUserModel {
  id = 0;
  username = '';
  displayName: string | null = null;
  avatarUrl: string | null = null;
}

// Реакции одного вида под сообщением: сколько их и кто поставил
export class ReactionModel {
  emoji = '';
  count = 0;
  userIds: number[] = [];
}

export class MessageModel {
  // null, пока сообщение не подтверждено сервером
  id: number | null = null;
  roomId = 0;
  senderId = 0;
  clientMsgId = '';
  content = '';
  createdAt = '';
  editedAt: string | null = null;
  deleted = false;
  reactions: ReactionModel[] = [];
  status: MessageStatus = 'sent';
  error: string | null = null;
}
