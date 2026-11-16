import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserMapper } from '../src/mappers';
import { UserRecord } from '../src/models';
import { createTestApp, resetDb } from './helpers';

// Тесты UserMapper.toPublic: превращает запись пользователя из БД в публичное представление
// для ответов API, без хеша пароля. Сгруппированы по приёмам тестирования
// из книги «Совершенный код» (гл. 22.3):
//   - граничные значения;
//   - классы данных: пустые значения и значения null;
//   - структурное тестирование: все поля результата;
//   - угадывание ошибок: утечка секретных и лишних полей, мутация исходного объекта;
//   - моки: проверка того, какие поля метод читает (а какие нет).
// Блок интеграционных тестов проходит через HTTP и настоящую БД.

const PUBLIC_FIELDS = [
  'avatarUrl',
  'createdAt',
  'displayName',
  'email',
  'id',
  'lastSeenAt',
  'username',
];

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return Object.assign(new UserRecord(), {
    id: 7,
    username: 'bob',
    email: 'bob@example.com',
    passwordHash: '$argon2id$секретный-хеш',
    displayName: 'Боб',
    avatarUrl: 'http://example.com/bob.png',
    lastSeenAt: new Date('2026-02-01T12:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

describe('UserMapper.toPublic: модульные тесты', () => {
  describe('структурное тестирование: все поля результата', () => {
    it('переносит все публичные поля записи пользователя', () => {
      const user = userRecord();
      expect(UserMapper.toPublic(user)).toEqual({
        id: 7,
        username: 'bob',
        email: 'bob@example.com',
        displayName: 'Боб',
        avatarUrl: 'http://example.com/bob.png',
        lastSeenAt: new Date('2026-02-01T12:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
    });

    it('в результате ровно семь публичных полей, ничего лишнего', () => {
      const keys = Object.keys(UserMapper.toPublic(userRecord())).sort();
      expect(keys).toEqual(PUBLIC_FIELDS);
    });
  });

  describe('граничные значения и классы данных', () => {
    it('значения null (профиль не заполнен, пользователь ещё не заходил) остаются null', () => {
      const result = UserMapper.toPublic(
        userRecord({ displayName: null, avatarUrl: null, lastSeenAt: null }),
      );
      expect(result.displayName).toBeNull();
      expect(result.avatarUrl).toBeNull();
      expect(result.lastSeenAt).toBeNull();
    });

    it('пустые строки не заменяются и не превращаются в null', () => {
      const result = UserMapper.toPublic(userRecord({ displayName: '', avatarUrl: '' }));
      expect(result.displayName).toBe('');
      expect(result.avatarUrl).toBe('');
    });

    it('запись по умолчанию (id = 0, пустые строки) преобразуется без ошибок', () => {
      const result = UserMapper.toPublic(new UserRecord());
      expect(result.id).toBe(0);
      expect(result.username).toBe('');
      expect(result.createdAt).toEqual(new Date(0));
    });

    it('очень большой id переносится без искажений', () => {
      const result = UserMapper.toPublic(userRecord({ id: Number.MAX_SAFE_INTEGER }));
      expect(result.id).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('угадывание ошибок', () => {
    it('хеш пароля не попадает в результат ни как поле, ни в сериализованном виде', () => {
      const result = UserMapper.toPublic(userRecord());
      expect(result).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain('argon2');
      expect(JSON.stringify(result)).not.toContain('секретный');
    });

    it('лишние поля, добавленные к записи, тоже не утекают', () => {
      const user = Object.assign(userRecord(), { internalNote: 'не для клиентов', token: 'abc' });
      const result = UserMapper.toPublic(user);
      expect(result).not.toHaveProperty('internalNote');
      expect(result).not.toHaveProperty('token');
    });

    it('исходная запись не меняется: хеш пароля остаётся на месте', () => {
      const user = userRecord();
      UserMapper.toPublic(user);
      expect(user.passwordHash).toBe('$argon2id$секретный-хеш');
      expect(Object.keys(user)).toContain('passwordHash');
    });

    it('возвращается новый объект, а не сама запись', () => {
      const user = userRecord();
      const result = UserMapper.toPublic(user);
      expect(result).not.toBe(user);
    });
  });

  describe('моки: какие поля метод читает', () => {
    it('поле passwordHash не читается вообще, а публичные поля читаются по одному разу', () => {
      // Вместо обычных значений у записи геттеры-заглушки: они считают обращения
      const read = {
        passwordHash: vi.fn(() => 'секрет'),
        username: vi.fn(() => 'bob'),
        email: vi.fn(() => 'bob@example.com'),
      };
      const user = userRecord();
      Object.defineProperty(user, 'passwordHash', { get: read.passwordHash });
      Object.defineProperty(user, 'username', { get: read.username });
      Object.defineProperty(user, 'email', { get: read.email });

      const result = UserMapper.toPublic(user);

      expect(read.passwordHash).toHaveBeenCalledTimes(0);
      expect(read.username).toHaveBeenCalledTimes(1);
      expect(read.email).toHaveBeenCalledTimes(1);
      expect(result.username).toBe('bob');
    });
  });
});

describe('UserMapper.toPublic: через HTTP и настоящую БД', () => {
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

  it('ответ регистрации содержит только публичные поля пользователя', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'carol', email: 'carol@example.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json().user).sort()).toEqual(PUBLIC_FIELDS);
    expect(res.body).not.toContain('argon2');
  });

  it('ответ входа тоже не содержит хеша пароля', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'carol', email: 'carol@example.com', password: 'password123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'carol@example.com', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);
    expect(Object.keys(login.json().user).sort()).toEqual(PUBLIC_FIELDS);
    expect(login.body).not.toContain('argon2');
  });
});
