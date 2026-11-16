import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRecord } from '../src/models';
import type { UserRepository } from '../src/repositories/userRepository';
import { AuthService } from '../src/services/authService';
import type { TokenManager } from '../src/services/tokenManager';
import { createTestApp, resetDb } from './helpers';

// Контракт метода AuthService.register: это РЕГИСТРАЦИЯ нового пользователя с выдачей токенов,
// а не вход (авторизация) существующего. Тесты сгруппированы по приёмам тестирования
// из книги «Совершенный код» (гл. 22.3):
//   - структурное тестирование: состав результата, ветка «пользователь уже есть»;
//   - угадывание ошибок: чужой пароль не проверяется, сбой хранилища токенов, уникальность токенов;
//   - граничные значения: срок жизни access-токена;
//   - моки: порядок и число вызовов зависимостей.
// Блок интеграционных тестов проходит через HTTP и настоящую БД.

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return Object.assign(new UserRecord(), {
    id: 42,
    username: 'bob',
    email: 'bob@example.com',
    passwordHash: 'stored-hash',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

function createFakes() {
  const users = {
    getUserByMail: vi.fn().mockResolvedValue(null),
    findByUsername: vi.fn().mockResolvedValue(null),
    create: vi.fn(
      async (username: string, email: string, passwordHash: string, displayName: string) =>
        userRecord({ username, email, passwordHash, displayName }),
    ),
  };
  const tokens = { save: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    users as unknown as UserRepository,
    tokens as unknown as TokenManager,
  );
  return { users, tokens, service };
}

describe('AuthService.register: контракт «регистрация, а не вход»', () => {
  describe('структурное тестирование', () => {
    it('возвращает пользователя и пару токенов, и ничего больше', async () => {
      const { service } = createFakes();
      const result = await service.register('bob', 'bob@example.com', 'password123');
      expect(Object.keys(result).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
      expect(result.accessToken.length).toBeGreaterThan(0);
      expect(result.refreshToken.length).toBeGreaterThan(0);
    });

    it('создаёт НОВУЮ запись: id в ответе и в токене принадлежит созданному пользователю', async () => {
      const { service, tokens } = createFakes();
      const result = await service.register('bob', 'bob@example.com', 'password123');
      expect(result.user.id).toBe(42);
      expect(service.verifyAccessToken(result.accessToken)).toBe(42);
      expect(tokens.save.mock.calls[0][0]).toBe(42);
    });

    it('если пользователь с таким email уже есть, это ошибка 409, а не вход: токены не выдаются', async () => {
      const { service, users, tokens } = createFakes();
      users.getUserByMail.mockResolvedValue(userRecord());
      await expect(service.register('bob', 'bob@example.com', 'password123')).rejects.toMatchObject(
        {
          statusCode: 409,
          code: 'email_taken',
        },
      );
      expect(tokens.save).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('угадывание ошибок', () => {
    it('пароль найденного пользователя не читается и не проверяется (это не вход)', async () => {
      const { service, users } = createFakes();
      const readHash = vi.fn(() => 'чужой-хеш');
      const existing = userRecord();
      Object.defineProperty(existing, 'passwordHash', { get: readHash });
      users.getUserByMail.mockResolvedValue(existing);

      await expect(
        service.register('bob', 'bob@example.com', 'password123'),
      ).rejects.toBeInstanceOf(Error);
      expect(readHash).toHaveBeenCalledTimes(0);
    });

    it('два вызова дают разные refresh-токены, и в хранилище уходят разные хеши', async () => {
      const { service, tokens } = createFakes();
      const first = await service.register('bob', 'bob@example.com', 'password123');
      const second = await service.register('ann', 'ann@example.com', 'password123');
      expect(first.refreshToken).not.toBe(second.refreshToken);
      expect(tokens.save).toHaveBeenCalledTimes(2);
      expect(tokens.save.mock.calls[0][1]).not.toBe(tokens.save.mock.calls[1][1]);
    });

    it('сбой хранилища токенов пробрасывается, ответ не возвращается', async () => {
      const { service, tokens } = createFakes();
      const failure = new Error('хранилище токенов недоступно');
      tokens.save.mockRejectedValue(failure);
      await expect(service.register('bob', 'bob@example.com', 'password123')).rejects.toBe(failure);
    });
  });

  describe('граничные значения', () => {
    it('access-токен живёт ровно 15 минут (900 секунд)', async () => {
      const { service } = createFakes();
      const result = await service.register('bob', 'bob@example.com', 'password123');
      const payload = jwt.decode(result.accessToken) as { iat: number; exp: number };
      expect(payload.exp - payload.iat).toBe(900);
    });
  });

  describe('моки: порядок и число вызовов', () => {
    it('сначала проверки уникальности, потом создание пользователя, потом сохранение токена', async () => {
      const { service, users, tokens } = createFakes();
      await service.register('bob', 'bob@example.com', 'password123');
      const order = [
        users.getUserByMail.mock.invocationCallOrder[0],
        users.findByUsername.mock.invocationCallOrder[0],
        users.create.mock.invocationCallOrder[0],
        tokens.save.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(users.create).toHaveBeenCalledTimes(1);
      expect(tokens.save).toHaveBeenCalledTimes(1);
    });
  });
});

describe('AuthService.register: через HTTP и настоящую БД', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
  });

  function register(username: string, email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, email, password: 'password123' },
    });
  }

  it('после регистрации пользователь сразу авторизован: access-токен открывает профиль', async () => {
    const res = await register('carol', 'carol@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${res.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('carol');
  });

  it('refresh-токен из регистрации обменивается на новую пару токенов', async () => {
    const res = await register('carol', 'carol@example.com');
    const cookie = res.cookies.find((c) => c.name === 'refresh_token');
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: cookie?.value ?? '' },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(typeof refreshed.json().accessToken).toBe('string');
  });

  it('вход и регистрация разные операции: без регистрации войти нельзя, после неё можно', async () => {
    const before = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'carol@example.com', password: 'password123' },
    });
    expect(before.statusCode).toBe(401);
    expect(before.json().error.code).toBe('invalid_credentials');

    await register('carol', 'carol@example.com');
    const after = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'carol@example.com', password: 'password123' },
    });
    expect(after.statusCode).toBe(200);
  });
});
