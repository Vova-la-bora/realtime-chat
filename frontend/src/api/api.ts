import { FoundUserModel, MemberModel, MessageModel, PublicRoomModel, UserModel } from '../models';
import { http } from './http';
import { toFoundUser, toMember, toMessage, toPublicRoom, toRoom, toUser } from './mappers';

export interface AuthResponse {
  user: UserModel;
  accessToken: string;
}

export interface HistoryPage {
  items: MessageModel[];
  hasMore: boolean;
  nextCursor: number | null;
}

export interface PublicRoomsPage {
  items: PublicRoomModel[];
  hasMore: boolean;
  nextCursor: number | null;
}

export const authApi = {
  async register(
    username: string,
    email: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResponse> {
    const res = await http.post<{ user: unknown; accessToken: string }>('/api/auth/register', {
      username,
      email,
      password,
      displayName,
    });
    return { user: toUser(res.user), accessToken: res.accessToken };
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await http.post<{ user: unknown; accessToken: string }>('/api/auth/login', {
      email,
      password,
    });
    return { user: toUser(res.user), accessToken: res.accessToken };
  },

  async logout(): Promise<void> {
    await http.post('/api/auth/logout');
  },
};

export const usersApi = {
  async updateMe(fields: { displayName?: string; avatarUrl?: string | null }): Promise<UserModel> {
    const res = await http.patch<{ user: unknown }>('/api/users/me', fields);
    return toUser(res.user);
  },

  async search(query: string): Promise<FoundUserModel[]> {
    const res = await http.get<{ items: unknown[] }>(
      `/api/users?query=${encodeURIComponent(query)}`,
    );
    return res.items.map(toFoundUser);
  },
};

export const roomsApi = {
  async list() {
    const res = await http.get<{ items: unknown[] }>('/api/rooms');
    return res.items.map(toRoom);
  },

  async listPublic(query: string, cursor: number | null): Promise<PublicRoomsPage> {
    let url = `/api/rooms/public?query=${encodeURIComponent(query)}`;
    if (cursor !== null) {
      url += `&cursor=${cursor}`;
    }
    const res = await http.get<{ items: unknown[]; hasMore: boolean; nextCursor: number | null }>(
      url,
    );
    return { items: res.items.map(toPublicRoom), hasMore: res.hasMore, nextCursor: res.nextCursor };
  },

  async create(name: string, type: string): Promise<number> {
    const res = await http.post<{ room: { id: number } }>('/api/rooms', { name, type });
    return res.room.id;
  },

  async openDirect(userId: number): Promise<number> {
    const res = await http.post<{ room: { id: number } }>('/api/rooms/direct', { userId });
    return res.room.id;
  },

  async join(roomId: number): Promise<void> {
    await http.post(`/api/rooms/${roomId}/join`);
  },

  async leave(roomId: number): Promise<void> {
    await http.post(`/api/rooms/${roomId}/leave`);
  },

  async invite(roomId: number, userId: number): Promise<void> {
    await http.post(`/api/rooms/${roomId}/invite`, { userId });
  },

  async history(roomId: number, beforeId: number | null, limit: number): Promise<HistoryPage> {
    let url = `/api/rooms/${roomId}/messages?limit=${limit}`;
    if (beforeId !== null) {
      url += `&before_id=${beforeId}`;
    }
    const res = await http.get<{ items: unknown[]; hasMore: boolean; nextCursor: number | null }>(
      url,
    );
    return { items: res.items.map(toMessage), hasMore: res.hasMore, nextCursor: res.nextCursor };
  },

  async search(
    roomId: number,
    query: string,
    beforeId: number | null,
    limit: number,
  ): Promise<HistoryPage> {
    let url = `/api/rooms/${roomId}/search?query=${encodeURIComponent(query)}&limit=${limit}`;
    if (beforeId !== null) {
      url += `&before_id=${beforeId}`;
    }
    const res = await http.get<{ items: unknown[]; hasMore: boolean; nextCursor: number | null }>(
      url,
    );
    return { items: res.items.map(toMessage), hasMore: res.hasMore, nextCursor: res.nextCursor };
  },

  async members(roomId: number): Promise<MemberModel[]> {
    const res = await http.get<{ items: unknown[] }>(`/api/rooms/${roomId}/members`);
    return res.items.map(toMember);
  },
};
