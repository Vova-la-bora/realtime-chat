import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createTestApp, registerUser, resetDb } from './helpers';

describe('Авторизация', () => {
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

  it('регистрирует пользователя и выдаёт httpOnly refresh-cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', email: 'alice@example.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.username).toBe('alice');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(typeof body.accessToken).toBe('string');
    const cookie = res.cookies.find((c) => c.name === 'refresh_token');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('не даёт зарегистрировать занятые username и email', async () => {
    await registerUser(app, 'alice');
    const sameName = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', email: 'other@example.com', password: 'password123' },
    });
    expect(sameName.statusCode).toBe(409);
    expect(sameName.json().error.code).toBe('username_taken');

    const sameEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice2', email: 'alice@example.com', password: 'password123' },
    });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().error.code).toBe('email_taken');
  });

  it('отклоняет короткий пароль и недопустимый username', async () => {
    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'bob', email: 'bob@example.com', password: 'short' },
    });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json().error.code).toBe('validation_error');

    const badName = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'bad name!', email: 'bob@example.com', password: 'password123' },
    });
    expect(badName.statusCode).toBe(400);
  });

  it('пускает с верным паролем и отказывает с неверным', async () => {
    await registerUser(app, 'alice', 'password123');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: 'password123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('invalid_credentials');
  });

  it('обновляет токены по refresh-cookie, старый refresh-токен перестаёт работать', async () => {
    const user = await registerUser(app, 'alice');
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: user.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().accessToken).toBeTruthy();
    const rotated = first.cookies.find((c) => c.name === 'refresh_token');
    expect(rotated?.value).toBeTruthy();
    expect(rotated?.value).not.toBe(user.refreshToken);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: user.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('logout отзывает refresh-токен', async () => {
    const user = await registerUser(app, 'alice');
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { refresh_token: user.refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: user.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('закрывает защищённые эндпоинты без токена и с неверным токеном', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/users/me' });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json().error.code).toBe('unauthorized');

    const badToken = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(badToken.statusCode).toBe(401);
    expect(badToken.json().error.code).toBe('invalid_token');
  });

  it('отдаёт и меняет профиль текущего пользователя', async () => {
    const user = await registerUser(app, 'alice');
    const me = await app.inject({ method: 'GET', url: '/api/users/me', headers: authHeader(user) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('alice');

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: authHeader(user),
      payload: { displayName: 'Алиса', avatarUrl: 'https://example.com/a.png' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().user.displayName).toBe('Алиса');
    expect(patched.json().user.avatarUrl).toBe('https://example.com/a.png');
  });
});
