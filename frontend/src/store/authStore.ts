import { create } from 'zustand';
import { authApi } from '../api/api';
import { http } from '../api/http';
import { UserModel } from '../models';
import { useChatStore } from './chatStore';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: UserModel | null;
  accessToken: string | null;
  status: AuthStatus;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserModel) => void;
}

let bootstrapPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'loading',

  // При запуске пробуем получить access-токен по refresh-cookie
  bootstrap() {
    if (!bootstrapPromise) {
      bootstrapPromise = http.refreshToken().then((ok) => {
        if (!ok) {
          set({ status: 'anonymous' });
        }
      });
    }
    return bootstrapPromise;
  },

  async login(email, password) {
    const res = await authApi.login(email, password);
    http.token = res.accessToken;
    set({ user: res.user, accessToken: res.accessToken, status: 'authenticated' });
  },

  async register(username, email, password, displayName) {
    const res = await authApi.register(username, email, password, displayName);
    http.token = res.accessToken;
    set({ user: res.user, accessToken: res.accessToken, status: 'authenticated' });
  },

  async logout() {
    try {
      await authApi.logout();
    } catch {
      // сервер недоступен: локальную сессию всё равно завершаем
    }
    clearSession();
  },

  setUser: (user) => set({ user }),
}));

// Локальное завершение сессии: без обращения к серверу
export function clearSession(): void {
  http.token = null;
  useChatStore.getState().reset();
  useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' });
}

http.onTokenRefreshed = (token, user) => {
  useAuthStore.setState({ user, accessToken: token, status: 'authenticated' });
};
http.onSessionLost = clearSession;
