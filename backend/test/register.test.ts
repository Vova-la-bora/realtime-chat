import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db';
import { UserRecord } from '../src/models';
import type { UserRepository } from '../src/repositories/userRepository';
import { AuthService } from '../src/services/authService';
import type { TokenManager } from '../src/services/tokenManager';
import { createTestApp, resetDb } from './helpers';

// Тесты метода AuthService.register. Сгруппированы по приёмам тестирования
// из книги «Совершенный код» (гл. 22.3):
//   - граничные значения;
//   - классы плохих данных (классы эквивалентности);
//   - структурное тестирование: каждая ветка метода хотя бы раз;
//   - угадывание ошибок;
//   - моки: проверка взаимодействия с зависимостями (сколько раз и с чем вызваны).
// Модульные тесты работают с заглушками вместо репозиториев. Тесты в последнем блоке
// проходят через HTTP и настоящую БД.

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return Object.assign(new UserRecord(), {
    id: 7,
    username: 'bob',
    email: 'bob@example.com',
    passwordHash: 'stored-hash',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

// Заглушки зависимостей: репозиторий пользователей и хранилище токенов.
// vi.fn() запоминает вызовы, поэтому ими можно проверять поведение, а не только результат.
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

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string) {
  await expect(promise).rejects.toMatchObject({ statusCode, code });
}

describe('AuthService.register: модульные тесты с заглушками', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('граничные значения', () => {
    it('имя из 2 символов отклоняется: на единицу меньше минимума', async () => {
      const { service, users } = createFakes();
      await expectAppError(
        service.register('ab', 'a@example.com', 'password123'),
        400,
        'validation_error',
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('имя из 3 символов принимается: ровно минимум', async () => {
      const { service } = createFakes();
      const result = await service.register('abc', 'a@example.com', 'password123');
      expect(result.user.username).toBe('abc');
    });

    it('имя из 20 символов принимается: ровно максимум', async () => {
      const { service } = createFakes();
      const name = 'a'.repeat(20);
      const result = await service.register(name, 'a@example.com', 'password123');
      expect(result.user.username).toBe(name);
    });

    it('имя из 21 символа отклоняется: на единицу больше максимума', async () => {
      const { service, users } = createFakes();
      await expectAppError(
        service.register('a'.repeat(21), 'a@example.com', 'password123'),
        400,
        'validation_error',
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('пароль из 7 символов отклоняется, из 8 принимается', async () => {
      const { service, users } = createFakes();
      await expectAppError(
        service.register('bob', 'bob@example.com', '1234567'),
        400,
        'validation_error',
      );
      expect(users.create).not.toHaveBeenCalled();

      const result = await service.register('bob', 'bob@example.com', '12345678');
      expect(result.user.username).toBe('bob');
      expect(users.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('классы плохих данных', () => {
    it.each(['bad name', 'bad-name', 'a!b?c', 'имя_юзера'])(
      'имя «%s» с недопустимыми символами отклоняется',
      async (name) => {
        const { service, users } = createFakes();
        await expectAppError(
          service.register(name, 'a@example.com', 'password123'),
          400,
          'validation_error',
        );
        expect(users.create).not.toHaveBeenCalled();
      },
    );

    it('пустое имя и пустой пароль отклоняются', async () => {
      const { service } = createFakes();
      await expectAppError(
        service.register('', 'a@example.com', 'password123'),
        400,
        'validation_error',
      );
      await expectAppError(service.register('bob', 'a@example.com', ''), 400, 'validation_error');
    });

    it('имя из латиницы, цифр и подчёркивания принимается', async () => {
      const { service } = createFakes();
      const result = await service.register('Bob_2026', 'bob@example.com', 'password123');
      expect(result.user.username).toBe('Bob_2026');
    });
  });

  describe('структурное тестирование: ветки метода', () => {
    it('занятый email даёт 409 email_taken, имя не проверяется и пользователь не создаётся', async () => {
      const { service, users, tokens } = createFakes();
      users.getUserByMail.mockResolvedValue(userRecord());
      await expectAppError(
        service.register('newbie', 'bob@example.com', 'password123'),
        409,
        'email_taken',
      );
      expect(users.findByUsername).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
      expect(tokens.save).not.toHaveBeenCalled();
    });

    it('занятое имя даёт 409 username_taken и пользователь не создаётся', async () => {
      const { service, users, tokens } = createFakes();
      users.findByUsername.mockResolvedValue(userRecord());
      await expectAppError(
        service.register('bob', 'new@example.com', 'password123'),
        409,
        'username_taken',
      );
      expect(users.create).not.toHaveBeenCalled();
      expect(tokens.save).not.toHaveBeenCalled();
    });

    it('свободные email и имя: пользователь создаётся ровно один раз', async () => {
      const { service, users } = createFakes();
      await service.register('bob', 'bob@example.com', 'password123');
      expect(users.getUserByMail).toHaveBeenCalledTimes(1);
      expect(users.findByUsername).toHaveBeenCalledWith('bob');
      expect(users.create).toHaveBeenCalledTimes(1);
    });

    it('без displayName в профиль попадает имя пользователя', async () => {
      const { service, users } = createFakes();
      await service.register('bob', 'bob@example.com', 'password123');
      expect(users.create.mock.calls[0][3]).toBe('bob');
    });

    it('переданный displayName сохраняется как есть', async () => {
      const { service, users } = createFakes();
      await service.register('bob', 'bob@example.com', 'password123', 'Боб Иванов');
      expect(users.create.mock.calls[0][3]).toBe('Боб Иванов');
    });
  });

  describe('угадывание ошибок', () => {
    it('email приводится к нижнему регистру и очищается от пробелов до проверки и сохранения', async () => {
      const { service, users } = createFakes();
      await service.register('bob', '  Bob@Example.COM  ', 'password123');
      expect(users.getUserByMail).toHaveBeenCalledWith('bob@example.com');
      expect(users.create.mock.calls[0][1]).toBe('bob@example.com');
    });

    it('гонка при регистрации: нарушение уникальности (23505) превращается в 409 user_exists', async () => {
      const { service, users, tokens } = createFakes();
      users.create.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
      await expectAppError(
        service.register('bob', 'bob@example.com', 'password123'),
        409,
        'user_exists',
      );
      expect(tokens.save).not.toHaveBeenCalled();
    });

    it('любая другая ошибка БД пробрасывается без изменений', async () => {
      const { service, users } = createFakes();
      const failure = new Error('connection lost');
      users.create.mockRejectedValue(failure);
      await expect(service.register('bob', 'bob@example.com', 'password123')).rejects.toBe(failure);
    });
  });

  describe('моки: проверка взаимодействия с зависимостями', () => {
    it('в репозиторий уходит хеш argon2, а не сам пароль', async () => {
      const { service, users } = createFakes();
      await service.register('bob', 'bob@example.com', 'password123');
      const savedHash = users.create.mock.calls[0][2];
      expect(savedHash).not.toBe('password123');
      expect(savedHash.startsWith('$argon2')).toBe(true);
    });

    it('refresh-токен сохраняется один раз: в виде SHA-256 и со сроком 7 суток', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { service, tokens } = createFakes();

      const result = await service.register('bob', 'bob@example.com', 'password123');

      expect(tokens.save).toHaveBeenCalledTimes(1);
      const [userId, storedHash, expiresAt] = tokens.save.mock.calls[0];
      expect(userId).toBe(7);
      expect(result.refreshToken).toMatch(/^[0-9a-f]{96}$/);
      expect(storedHash).toBe(createHash('sha256').update(result.refreshToken).digest('hex'));
      expect(storedHash).not.toBe(result.refreshToken);
      expect(expiresAt).toEqual(new Date('2026-01-08T00:00:00.000Z'));
    });

    it('access-токен принадлежит созданному пользователю', async () => {
      const { service } = createFakes();
      const result = await service.register('bob', 'bob@example.com', 'password123');
      expect(service.verifyAccessToken(result.accessToken)).toBe(7);
    });

    it('в ответе нет хеша пароля', async () => {
      const { service } = createFakes();
      const result = await service.register('bob', 'bob@example.com', 'password123');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.email).toBe('bob@example.com');
    });

    it('при ошибке валидации репозиторий и хранилище токенов вообще не вызываются', async () => {
      const { service, users, tokens } = createFakes();
      await expect(service.register('ab', 'bob@example.com', 'password123')).rejects.toBeInstanceOf(
        Error,
      );
      expect(users.getUserByMail).not.toHaveBeenCalled();
      expect(users.findByUsername).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
      expect(tokens.save).not.toHaveBeenCalled();
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

  async function register(username: string, email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, email, password: 'password123' },
    });
  }

  it('email в верхнем регистре сохраняется в БД в нижнем', async () => {
    const res = await register('carol', 'Carol@Example.COM');
    expect(res.statusCode).toBe(201);
    const row = await pool.query('SELECT email FROM users WHERE username = $1', ['carol']);
    expect(row.rows[0].email).toBe('carol@example.com');
  });

  it('тот же email в другом регистре считается занятым', async () => {
    await register('carol', 'carol@example.com');
    const res = await register('carol2', 'CAROL@EXAMPLE.COM');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('email_taken');
  });

  it('после регистрации можно войти, написав email в другом регистре', async () => {
    await register('carol', 'Carol@Example.com');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'CAROL@example.com', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.username).toBe('carol');
  });
});
