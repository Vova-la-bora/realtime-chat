import {
  FoundUserModel,
  LastMessageModel,
  MemberModel,
  MessageModel,
  PeerModel,
  PublicRoomModel,
  ReactionModel,
  RoomModel,
  UserModel,
} from '../models';

// Ответы сервера приходят как JSON неизвестной формы; здесь они превращаются в модели
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function toUser(json: Json): UserModel {
  const u = new UserModel();
  u.id = json.id;
  u.username = json.username;
  u.email = json.email ?? '';
  u.displayName = json.displayName ?? null;
  u.avatarUrl = json.avatarUrl ?? null;
  return u;
}

export function toReaction(json: Json): ReactionModel {
  const r = new ReactionModel();
  r.emoji = json.emoji;
  r.count = json.count;
  r.userIds = json.userIds ?? [];
  return r;
}

export function toMessage(json: Json): MessageModel {
  const m = new MessageModel();
  m.id = json.id;
  m.roomId = json.roomId;
  m.senderId = json.senderId;
  m.clientMsgId = json.clientMsgId;
  m.content = json.content;
  m.createdAt = json.createdAt;
  m.editedAt = json.editedAt ?? null;
  m.deleted = Boolean(json.deleted);
  m.reactions = (json.reactions ?? []).map(toReaction);
  m.status = 'sent';
  return m;
}

export function toRoom(json: Json): RoomModel {
  const r = new RoomModel();
  r.id = json.id;
  r.type = json.type;
  r.title = json.title;
  r.role = json.role;
  r.unread = json.unread;
  if (json.peer) {
    const p = new PeerModel();
    p.id = json.peer.id;
    p.username = json.peer.username;
    p.displayName = json.peer.displayName ?? null;
    p.avatarUrl = json.peer.avatarUrl ?? null;
    r.peer = p;
  }
  if (json.lastMessage) {
    const l = new LastMessageModel();
    l.id = json.lastMessage.id;
    l.senderId = json.lastMessage.senderId;
    l.content = json.lastMessage.content;
    l.createdAt = json.lastMessage.createdAt;
    r.lastMessage = l;
  }
  return r;
}

export function toPublicRoom(json: Json): PublicRoomModel {
  const r = new PublicRoomModel();
  r.id = json.id;
  r.type = json.type;
  r.name = json.name ?? null;
  r.createdBy = json.createdBy ?? null;
  return r;
}

export function toMember(json: Json): MemberModel {
  const m = new MemberModel();
  m.userId = json.userId;
  m.username = json.username;
  m.displayName = json.displayName ?? null;
  m.avatarUrl = json.avatarUrl ?? null;
  m.role = json.role;
  m.online = Boolean(json.online);
  m.lastSeenAt = json.lastSeenAt ?? null;
  m.lastReadMessageId = json.lastReadMessageId ?? 0;
  return m;
}

export function toFoundUser(json: Json): FoundUserModel {
  const u = new FoundUserModel();
  u.id = json.id;
  u.username = json.username;
  u.displayName = json.displayName ?? null;
  u.avatarUrl = json.avatarUrl ?? null;
  return u;
}
