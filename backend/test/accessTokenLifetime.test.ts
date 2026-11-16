import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { UserRecord } from '../src/models';
import type { UserRepository } from '../src/repositories/userRepository';
import { AuthService } from '../src/services/authService';
import type { TokenManager } from '../src/services/tokenManager';
import { authHeader, createTestApp, registerUser, resetDb } from './helpers';

// Тесты срока жизни access-токена в AuthService: register, login и refresh. Во всех трёх
// методах он задан числом 900 прямо в вызове jwt.sign (Issue #8). Тесты фиксируют, что токен
// живёт ровно 900 секунд (15 минут) в каждом из методов. Сгруппированы по приёмам
// тестирования из книги «Совершенный код» (гл. 22.3):
//   - граничные значения: 899 секунд, ровно 900, 901; срок не равен сроку refresh-токена;
//   - классы данных: три способа получить токен (register, login, refresh);
//   - структурное тестирование: токен выдаётся только на успешной ветке метода;
//   - угадывание ошибок: refresh выдаёт новый срок, а не наследует остаток старого;
//   - моки: с какими параметрами вызывается jwt.sign.
// Блок интеграционных тестов проходит через HTTP и настоящую БД.

const LIFETIME_SECONDS = 900;
const PASSWORD = 'password123';

let passwordHash = '';

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return Object.assign(new UserRecord(), {
    id: 7,
    username: 'bob',
    email: 'bob@example.com',
    passwordHash,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

// Заглушки зависимостей: репозиторий пользователей и хранилище токенов
function createFakes() {
  const users = {
    getUserByMail: vi.fn(async (email: string) =>
      email === 'bob@example.com' ? userRecord() : null,
    ),
    findByUsername: vi.fn().mockResolvedValue(null),
    findById: vi.fn(async (id: number) => (id === 7 ? userRecord() : null)),
    create: vi.fn(async (username: string, email: string, hash: string, displayName: string) =>
      userRecord({ username, email, passwordHash: hash, displayName }),
    ),
  };
  const tokens = {
    save: vi.fn().mockResolvedValue(undefined),
    findActive: vi.fn().mockResolvedValue({ id: 1, userId: 7 }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    users as unknown as UserRepository,
    tokens as unknown as TokenManager,
  );
  return { users, tokens, service };
}

type Issue = (service: AuthService) => Promise<string>;

// Три способа получить access-токен
const issuers: Array<[string, Issue]> = [
  ['register', async (s) => (await s.register('newbie', 'new@example.com', PASSWORD)).accessToken],
  ['login', async (s) => (await s.login('bob@example.com', PASSWORD)).accessToken],
  ['refresh', async (s) => (await s.refresh('old-refresh-token')).accessToken],
];

function lifetimeOf(token: string): number {
  const payload = jwt.decode(token) as { iat: number; exp: number };
  return payload.exp - payload.iat;
}

// Время замирает на целой секунде, поэтому iat и exp в токене предсказуемы
function freezeTime(iso = '2026-01-01T00:00:00Z'): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD);
});

describe('срок жизни access-токена: модульные тесты с заглушками', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('классы данных: все три способа получить токен', () => {
    it.each(issuers)('%s: токен живёт ровно 900 секунд (exp минус iat)', async (_name, issue) => {
      const { service } = createFakes();
      const token = await issue(service);
      expect(lifetimeOf(token)).toBe(LIFETIME_SECONDS);
    });

    it('register, login и refresh дают одинаковый срок жизни', async () => {
      const { service } = createFakes();
      const lifetimes: number[] = [];
      for (const [, issue] of issuers) {
        lifetimes.push(lifetimeOf(await issue(service)));
      }
      expect(new Set(lifetimes).size).toBe(1);
      expect(lifetimes[0]).toBe(LIFETIME_SECONDS);
    });

    it.each(issuers)(
      '%s: в токене лежит id пользователя и он подписан секретом приложения',
      async (_name, issue) => {
        const { service } = createFakes();
        const token = await issue(service);
        const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
        expect(payload.sub).toBe('7');
        expect(() => jwt.verify(token, 'чужой-секрет')).toThrow();
      },
    );
  });

  describe('граничные значения: когда токен перестаёт действовать', () => {
    it.each(issuers)(
      '%s: за секунду до конца срока (899 с) токен принимается',
      async (_name, issue) => {
        freezeTime();
        const { service } = createFakes();
        const token = await issue(service);
        vi.setSystemTime(new Date('2026-01-01T00:14:59Z'));
        expect(service.verifyAccessToken(token)).toBe(7);
      },
    );

    it.each(issuers)(
      '%s: ровно через 900 секунд токен уже не принимается',
      async (_name, issue) => {
        freezeTime();
        const { service } = createFakes();
        const token = await issue(service);
        vi.setSystemTime(new Date('2026-01-01T00:15:00Z'));
        expect(() => service.verifyAccessToken(token)).toThrow(
          expect.objectContaining({ statusCode: 401, code: 'invalid_token' }),
        );
      },
    );

    it('через 901 секунду, час и сутки токен не принимается', async () => {
      freezeTime();
      const { service } = createFakes();
      const token = await issuers[0][1](service);
      for (const iso of ['2026-01-01T00:15:01Z', '2026-01-01T01:00:00Z', '2026-01-02T00:00:00Z']) {
        vi.setSystemTime(new Date(iso));
        expect(() => service.verifyAccessToken(token)).toThrow(
          expect.objectContaining({ code: 'invalid_token' }),
        );
      }
    });

    it('срок access-токена не равен сроку refresh-токена (7 суток)', async () => {
      freezeTime();
      const { service, tokens } = createFakes();
      const result = await service.register('newbie', 'new@example.com', PASSWORD);
      const refreshExpiresAt = tokens.save.mock.calls[0][2] as Date;
      const accessExpiresAt = (jwt.decode(result.accessToken) as { exp: number }).exp * 1000;
      expect(refreshExpiresAt.getTime() - Date.now()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(accessExpiresAt - Date.now()).toBe(LIFETIME_SECONDS * 1000);
    });
  });

  describe('структурное тестирование и угадывание ошибок', () => {
    it('refresh выдаёт новый срок от момента обмена, а не остаток старого', async () => {
      freezeTime();
      const { service } = createFakes();
      const first = await service.login('bob@example.com', PASSWORD);
      // Через 10 минут от первого токена осталось 5 минут
      vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
      const second = await service.refresh('old-refresh-token');
      const secondPayload = jwt.decode(second.accessToken) as { iat: number; exp: number };
      expect(secondPayload.exp - secondPayload.iat).toBe(LIFETIME_SECONDS);
      expect(secondPayload.exp).toBe(Math.floor(Date.parse('2026-01-01T00:25:00Z') / 1000));
      // К моменту, когда первый токен уже умер, второй ещё действует
      vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
      expect(() => service.verifyAccessToken(first.accessToken)).toThrow();
      expect(service.verifyAccessToken(second.accessToken)).toBe(7);
    });

    it('login с неверным паролем не выдаёт токен', async () => {
      const { service, tokens } = createFakes();
      const sign = vi.spyOn(jwt, 'sign');
      await expect(service.login('bob@example.com', 'wrong-password')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
      expect(sign).not.toHaveBeenCalled();
      expect(tokens.save).not.toHaveBeenCalled();
    });

    it('refresh с неизвестным токеном не выдаёт access-токен', async () => {
      const { service, tokens } = createFakes();
      tokens.findActive.mockResolvedValueOnce(null);
      const sign = vi.spyOn(jwt, 'sign');
      await expect(service.refresh('unknown')).rejects.toMatchObject({
        code: 'invalid_refresh_token',
      });
      expect(sign).not.toHaveBeenCalled();
    });

    it('register с занятым email не выдаёт токен', async () => {
      const { service } = createFakes();
      const sign = vi.spyOn(jwt, 'sign');
      await expect(service.register('newbie', 'bob@example.com', PASSWORD)).rejects.toMatchObject({
        code: 'email_taken',
      });
      expect(sign).not.toHaveBeenCalled();
    });
  });

  describe('моки: с какими параметрами вызывается jwt.sign', () => {
    it.each(issuers)('%s: jwt.sign вызывается один раз с expiresIn: 900', async (_name, issue) => {
      const { service } = createFakes();
      const sign = vi.spyOn(jwt, 'sign');
      await issue(service);
      expect(sign).toHaveBeenCalledTimes(1);
      const [payload, secret, options] = sign.mock.calls[0];
      expect(payload).toEqual({ sub: '7' });
      expect(secret).toBe(config.jwtSecret);
      expect(options).toEqual({ expiresIn: LIFETIME_SECONDS });
    });

    it('срок передаётся числом секунд: строка "900" означала бы 900 миллисекунд', async () => {
      const { service } = createFakes();
      const sign = vi.spyOn(jwt, 'sign');
      await service.login('bob@example.com', PASSWORD);
      const options = sign.mock.calls[0][2] as { expiresIn: unknown };
      expect(typeof options.expiresIn).toBe('number');
    });
  });
});

describe('срок жизни access-токена: через HTTP и настоящую БД', () => {
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

  it('POST /api/auth/register выдаёт токен на 900 секунд, и он сразу работает', async () => {
    const alice = await registerUser(app, 'alice');
    expect(lifetimeOf(alice.accessToken)).toBe(LIFETIME_SECONDS);
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(alice) });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/auth/login выдаёт токен на 900 секунд', async () => {
    await registerUser(app, 'alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(lifetimeOf(res.json().accessToken)).toBe(LIFETIME_SECONDS);
  });

  it('POST /api/auth/refresh выдаёт токен на 900 секунд', async () => {
    const alice = await registerUser(app, 'alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: alice.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    expect(lifetimeOf(res.json().accessToken)).toBe(LIFETIME_SECONDS);
  });
});
