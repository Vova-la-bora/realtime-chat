import { create } from 'zustand';
import { mergeMessages } from '../lib/messageMerge';
import {
  LastMessageModel,
  MemberModel,
  MessageModel,
  PresenceInfo,
  ReactionModel,
  RoomModel,
} from '../models';

export interface RoomMessages {
  items: MessageModel[];
  hasMore: boolean;
  nextCursor: number | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export type ConnectionState = 'connecting' | 'online' | 'offline';

function emptyBucket(): RoomMessages {
  return {
    items: [],
    hasMore: false,
    nextCursor: null,
    loading: false,
    loaded: false,
    error: null,
  };
}

function previewOf(m: MessageModel): LastMessageModel {
  const preview = new LastMessageModel();
  preview.id = m.id ?? 0;
  preview.senderId = m.senderId;
  preview.content = m.content;
  preview.createdAt = m.createdAt;
  return preview;
}

// Убирает пользователя из списка «печатает» (если он там есть)
function withoutTyping(
  typing: Record<number, number[]>,
  roomId: number,
  userId: number,
): Record<number, number[]> {
  const list = typing[roomId];
  if (!list || !list.includes(userId)) {
    return typing;
  }
  return { ...typing, [roomId]: list.filter((id) => id !== userId) };
}

// Обновляет комнату и поднимает её наверх списка (новые сообщения всплывают вверх)
function bumpRoom(
  rooms: RoomModel[],
  roomId: number,
  update: (room: RoomModel) => RoomModel,
): RoomModel[] {
  const target = rooms.find((r) => r.id === roomId);
  if (!target) {
    return rooms;
  }
  return [update(target), ...rooms.filter((r) => r.id !== roomId)];
}

interface ChatState {
  rooms: RoomModel[];
  roomsLoaded: boolean;
  messages: Record<number, RoomMessages>;
  members: Record<number, MemberModel[]>;
  activeRoomId: number | null;
  connection: ConnectionState;
  notice: string | null;
  // Присутствие по id пользователя
  presence: Record<number, PresenceInfo>;
  // До какого сообщения прочитал комнату каждый участник: комната -> пользователь -> id
  reads: Record<number, Record<number, number>>;
  // Кто сейчас печатает: комната -> id пользователей
  typing: Record<number, number[]>;

  setRooms: (rooms: RoomModel[]) => void;
  setActiveRoom: (roomId: number | null) => void;
  removeRoom: (roomId: number) => void;
  setConnection: (state: ConnectionState) => void;
  setNotice: (notice: string | null) => void;
  setMembers: (roomId: number, members: MemberModel[]) => void;

  startLoading: (roomId: number) => void;
  finishLoadLatest: (
    roomId: number,
    items: MessageModel[],
    hasMore: boolean,
    nextCursor: number | null,
  ) => void;
  finishLoadOlder: (
    roomId: number,
    items: MessageModel[],
    hasMore: boolean,
    nextCursor: number | null,
  ) => void;
  failLoading: (roomId: number, error: string) => void;
  mergeIntoRoom: (roomId: number, items: MessageModel[]) => void;
  replaceRoomMessages: (
    roomId: number,
    items: MessageModel[],
    hasMore: boolean,
    nextCursor: number | null,
  ) => void;

  addPending: (message: MessageModel) => void;
  receiveMessage: (message: MessageModel) => void;
  confirmMessage: (message: MessageModel) => void;
  markMessage: (
    roomId: number,
    clientMsgId: string,
    patch: Pick<MessageModel, 'status' | 'error'>,
  ) => void;
  failSending: (error: string) => void;

  setPresence: (userId: number, online: boolean, lastSeenAt: string | null) => void;
  setRead: (roomId: number, userId: number, messageId: number) => void;
  setTyping: (roomId: number, userId: number, typing: boolean) => void;
  clearUnread: (roomId: number) => void;
  applyEdited: (message: MessageModel) => void;
  applyDeleted: (roomId: number, messageId: number) => void;
  applyReactions: (roomId: number, messageId: number, reactions: ReactionModel[]) => void;
  reset: () => void;
}

const initialState = {
  rooms: [] as RoomModel[],
  roomsLoaded: false,
  messages: {} as Record<number, RoomMessages>,
  members: {} as Record<number, MemberModel[]>,
  activeRoomId: null as number | null,
  connection: 'offline' as ConnectionState,
  notice: null as string | null,
  presence: {} as Record<number, PresenceInfo>,
  reads: {} as Record<number, Record<number, number>>,
  typing: {} as Record<number, number[]>,
};

export const useChatStore = create<ChatState>((set) => {
  // Меняет «корзину» сообщений одной комнаты
  const updateBucket = (roomId: number, patch: (b: RoomMessages) => RoomMessages) =>
    set((s) => ({
      messages: { ...s.messages, [roomId]: patch(s.messages[roomId] ?? emptyBucket()) },
    }));

  return {
    ...initialState,

    setRooms: (rooms) =>
      set((s) => ({
        rooms: rooms.map((r) => (r.id === s.activeRoomId ? { ...r, unread: 0 } : r)),
        roomsLoaded: true,
      })),

    setActiveRoom: (roomId) =>
      set((s) => ({
        activeRoomId: roomId,
        rooms:
          roomId === null
            ? s.rooms
            : s.rooms.map((r) => (r.id === roomId && r.unread > 0 ? { ...r, unread: 0 } : r)),
      })),

    removeRoom: (roomId) =>
      set((s) => {
        const messages = { ...s.messages };
        delete messages[roomId];
        const members = { ...s.members };
        delete members[roomId];
        const reads = { ...s.reads };
        delete reads[roomId];
        const typing = { ...s.typing };
        delete typing[roomId];
        return {
          rooms: s.rooms.filter((r) => r.id !== roomId),
          messages,
          members,
          reads,
          typing,
          activeRoomId: s.activeRoomId === roomId ? null : s.activeRoomId,
        };
      }),

    setConnection: (connection) => set({ connection }),
    setNotice: (notice) => set({ notice }),
    // Список участников приносит и их статусы, и отметки «прочитано»
    setMembers: (roomId, members) =>
      set((s) => {
        const presence = { ...s.presence };
        const roomReads = { ...(s.reads[roomId] ?? {}) };
        for (const m of members) {
          presence[m.userId] = { online: m.online, lastSeenAt: m.lastSeenAt };
          roomReads[m.userId] = Math.max(roomReads[m.userId] ?? 0, m.lastReadMessageId);
        }
        return {
          members: { ...s.members, [roomId]: members },
          presence,
          reads: { ...s.reads, [roomId]: roomReads },
        };
      }),

    startLoading: (roomId) => updateBucket(roomId, (b) => ({ ...b, loading: true, error: null })),

    finishLoadLatest: (roomId, items, hasMore, nextCursor) =>
      updateBucket(roomId, (b) => ({
        items: mergeMessages(b.items, items),
        hasMore,
        nextCursor,
        loading: false,
        loaded: true,
        error: null,
      })),

    finishLoadOlder: (roomId, items, hasMore, nextCursor) =>
      updateBucket(roomId, (b) => ({
        ...b,
        items: mergeMessages(b.items, items),
        hasMore,
        nextCursor,
        loading: false,
        error: null,
      })),

    failLoading: (roomId, error) => updateBucket(roomId, (b) => ({ ...b, loading: false, error })),

    mergeIntoRoom: (roomId, items) =>
      updateBucket(roomId, (b) => ({ ...b, items: mergeMessages(b.items, items) })),

    // Слишком большой разрыв после переподключения: оставляем только свежие сообщения
    replaceRoomMessages: (roomId, items, hasMore, nextCursor) =>
      updateBucket(roomId, (b) => ({
        ...b,
        items: mergeMessages(
          b.items.filter((m) => m.id === null),
          items,
        ),
        hasMore,
        nextCursor,
        loaded: true,
      })),

    addPending: (message) =>
      set((s) => {
        const bucket = s.messages[message.roomId] ?? emptyBucket();
        return {
          messages: {
            ...s.messages,
            [message.roomId]: { ...bucket, items: mergeMessages(bucket.items, [message]) },
          },
          rooms: bumpRoom(s.rooms, message.roomId, (r) => ({
            ...r,
            lastMessage: previewOf(message),
          })),
        };
      }),

    receiveMessage: (message) =>
      set((s) => {
        const bucket = s.messages[message.roomId];
        const isActive = s.activeRoomId === message.roomId;
        return {
          // История комнаты, которую ещё не открывали, подгрузится целиком при открытии
          messages: bucket?.loaded
            ? {
                ...s.messages,
                [message.roomId]: { ...bucket, items: mergeMessages(bucket.items, [message]) },
              }
            : s.messages,
          rooms: bumpRoom(s.rooms, message.roomId, (r) => ({
            ...r,
            lastMessage: previewOf(message),
            unread: isActive ? r.unread : r.unread + 1,
          })),
          // Отправил сообщение, значит, печатать перестал
          typing: withoutTyping(s.typing, message.roomId, message.senderId),
        };
      }),

    confirmMessage: (message) =>
      set((s) => {
        const bucket = s.messages[message.roomId] ?? emptyBucket();
        return {
          messages: {
            ...s.messages,
            [message.roomId]: { ...bucket, items: mergeMessages(bucket.items, [message]) },
          },
          rooms: bumpRoom(s.rooms, message.roomId, (r) => ({
            ...r,
            lastMessage: previewOf(message),
          })),
        };
      }),

    markMessage: (roomId, clientMsgId, patch) =>
      updateBucket(roomId, (b) => ({
        ...b,
        items: b.items.map((m) =>
          m.clientMsgId === clientMsgId && m.id === null ? { ...m, ...patch } : m,
        ),
      })),

    failSending: (error) =>
      set((s) => {
        const messages: Record<number, RoomMessages> = {};
        for (const [id, bucket] of Object.entries(s.messages)) {
          messages[Number(id)] = {
            ...bucket,
            items: bucket.items.map((m) =>
              m.status === 'sending' ? { ...m, status: 'error', error } : m,
            ),
          };
        }
        return { messages };
      }),

    setPresence: (userId, online, lastSeenAt) =>
      set((s) => ({
        presence: {
          ...s.presence,
          [userId]: { online, lastSeenAt: lastSeenAt ?? s.presence[userId]?.lastSeenAt ?? null },
        },
      })),

    // Отметка «прочитано» двигается только вперёд
    setRead: (roomId, userId, messageId) =>
      set((s) => {
        const current = s.reads[roomId]?.[userId] ?? 0;
        if (messageId <= current) {
          return s;
        }
        return { reads: { ...s.reads, [roomId]: { ...s.reads[roomId], [userId]: messageId } } };
      }),

    setTyping: (roomId, userId, typing) =>
      set((s) => {
        if (!typing) {
          return { typing: withoutTyping(s.typing, roomId, userId) };
        }
        const list = s.typing[roomId] ?? [];
        if (list.includes(userId)) {
          return s;
        }
        return { typing: { ...s.typing, [roomId]: [...list, userId] } };
      }),

    clearUnread: (roomId) =>
      set((s) => ({
        rooms: s.rooms.map((r) => (r.id === roomId && r.unread > 0 ? { ...r, unread: 0 } : r)),
      })),

    applyEdited: (message) =>
      set((s) => {
        const bucket = s.messages[message.roomId];
        return {
          messages: bucket
            ? {
                ...s.messages,
                [message.roomId]: {
                  ...bucket,
                  items: bucket.items.map((m) =>
                    m.id === message.id
                      ? { ...m, content: message.content, editedAt: message.editedAt }
                      : m,
                  ),
                },
              }
            : s.messages,
          rooms: s.rooms.map((r) =>
            r.lastMessage?.id === message.id ? { ...r, lastMessage: previewOf(message) } : r,
          ),
        };
      }),

    applyDeleted: (roomId, messageId) =>
      set((s) => {
        const bucket = s.messages[roomId];
        return {
          messages: bucket
            ? {
                ...s.messages,
                [roomId]: {
                  ...bucket,
                  items: bucket.items.map((m) =>
                    m.id === messageId ? { ...m, deleted: true, content: 'сообщение удалено' } : m,
                  ),
                },
              }
            : s.messages,
          rooms: s.rooms.map((r) =>
            r.id === roomId && r.lastMessage?.id === messageId
              ? { ...r, lastMessage: { ...r.lastMessage, content: 'сообщение удалено' } }
              : r,
          ),
        };
      }),

    // Сервер присылает полный актуальный набор реакций сообщения, он заменяет прежний
    applyReactions: (roomId, messageId, reactions) =>
      updateBucket(roomId, (b) => ({
        ...b,
        items: b.items.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
      })),

    reset: () => set({ ...initialState }),
  };
});
