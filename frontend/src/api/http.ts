import { UserModel } from '../models';
import { toUser } from './mappers';
import { RawRequester } from './raw';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// HTTP-клиент: подставляет access-токен и один раз обновляет его при 401
export class HttpClient {
  public token: string | null = null;
  public refreshing: Promise<boolean> | null = null;
  public onTokenRefreshed: ((token: string, user: UserModel) => void) | null = null;
  public onSessionLost: (() => void) | null = null;

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Нет соединения с сервером');
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) {
      return data as T;
    }
    const code: string = data?.error?.code ?? 'unknown';
    const message: string = data?.error?.message ?? `Ошибка запроса (${res.status})`;
    if (res.status === 401 && retry && (code === 'unauthorized' || code === 'invalid_token')) {
      if (await this.refreshToken()) {
        return this.request<T>(method, path, body, false);
      }
      this.onSessionLost?.();
    }
    throw new ApiError(res.status, code, message);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  // Обновление токена по refresh-cookie; параллельные вызовы делят один запрос
  refreshToken(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const result = await new RawRequester().postJson('/api/auth/refresh', {});
    if (result.status !== 200 || !result.data) {
      return false;
    }
    this.token = result.data.accessToken as string;
    this.onTokenRefreshed?.(this.token, toUser(result.data.user));
    return true;
  }
}

export const http = new HttpClient();
