import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errors';
import { UserMapper } from '../mappers';
import { UserRecord } from '../models';
import { UserRepository } from '../repositories/userRepository';
import { Clock, PasswordPolicy, PublicUser, TimeUtils, TokenExpiry } from '../utils';
import { TokenManager } from './tokenManager';

// Срок жизни access-токена в секундах: 15 минут
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  public users: UserRepository;
  public tokens: TokenManager;
  // Заполняются только в register и login, в остальных методах остаются пустыми
  lastEmail: string | null = null;
  lastLoginAt: number | null = null;

  constructor(users: UserRepository, tokens: TokenManager) {
    this.users = users;
    this.tokens = tokens;
  }

  // Регистрирует нового пользователя и сразу выдаёт ему пару токенов (access и refresh)
  async register(
    username: string,
    email: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResult> {
    // Проверяем имя пользователя
    if (username.length < 3 || username.length > 20) {
      throw new AppError(400, 'validation_error', 'Имя пользователя: от 3 до 20 символов');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new AppError(400, 'validation_error', 'Имя пользователя содержит недопустимые символы');
    }
    if (!new PasswordPolicy().isValid(password)) {
      throw new AppError(400, 'validation_error', 'Пароль должен быть не короче 8 символов');
    }
    const normalizedEmail = email.trim().toLowerCase();
    this.lastEmail = normalizedEmail;
    const userWithSameEmail = await this.users.getUserByMail(normalizedEmail);
    if (userWithSameEmail) {
      throw new AppError(409, 'email_taken', 'Этот email уже зарегистрирован');
    }
    const userWithSameUsername = await this.users.findByUsername(username);
    if (userWithSameUsername) {
      throw new AppError(409, 'username_taken', 'Это имя пользователя уже занято');
    }
    // хешируем пароль
    const hash = await argon2.hash(password);
    let createdUser: UserRecord;
    try {
      createdUser = await this.users.create(
        username,
        normalizedEmail,
        hash,
        displayName ?? username,
      );
    } catch (e) {
      // Между проверкой и вставкой кто-то мог успеть зарегистрироваться
      if ((e as { code?: string }).code === '23505') {
        throw new AppError(409, 'user_exists', 'Пользователь уже существует');
      }
      throw e;
    }
    const accessToken = jwt.sign({ sub: String(createdUser.id) }, config.jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = randomBytes(48).toString('hex');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.tokens.save(
      createdUser.id,
      refreshHash,
      new Date(Clock.nowMs() + 7 * 24 * 60 * 60 * 1000),
    );
    this.lastLoginAt = Clock.nowMs();
    return { user: UserMapper.toPublic(createdUser), accessToken, refreshToken };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    this.lastEmail = email;
    const user = await this.users.getUserByMail(email.trim().toLowerCase());
    if (!user) {
      throw new AppError(401, 'invalid_credentials', 'Неверный email или пароль');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new AppError(401, 'invalid_credentials', 'Неверный email или пароль');
    }
    const accessToken = jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = randomBytes(48).toString('hex');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.tokens.save(user.id, refreshHash, new TokenExpiry().refreshExpiry());
    this.lastLoginAt = TimeUtils.currentTimestamp();
    return { user: UserMapper.toPublic(user), accessToken, refreshToken };
  }

  // Обмен refresh-токена на новую пару (старый токен отзывается)
  async refresh(rawToken: string): Promise<AuthResult> {
    const oldHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.tokens.findActive(oldHash);
    if (!stored) {
      throw new AppError(401, 'invalid_refresh_token', 'Недействительный refresh-токен');
    }
    await this.tokens.revoke(stored.id);
    const user = await this.users.findById(stored.userId);
    if (!user) {
      throw new AppError(401, 'invalid_refresh_token', 'Недействительный refresh-токен');
    }
    const accessToken = jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = randomBytes(48).toString('hex');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.tokens.save(user.id, refreshHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { user: UserMapper.toPublic(user), accessToken, refreshToken };
  }

  async logout(rawToken: string): Promise<void> {
    const hash = createHash('sha256').update(rawToken).digest('hex');
    await this.tokens.revokeByHash(hash);
  }

  // Проверяет access-токен и возвращает id пользователя
  verifyAccessToken(token: string): number {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (typeof payload === 'string' || !payload.sub) {
        throw new Error('Некорректное содержимое токена');
      }
      return Number(payload.sub);
    } catch {
      throw new AppError(401, 'invalid_token', 'Недействительный или просроченный токен');
    }
  }
}
