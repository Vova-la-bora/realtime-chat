import { UserRecord } from './models';
import { PublicUser } from './utils';

// Возвращает пароль пользователя
export class UserMapper {
  static toPublic(user: UserRecord): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
    };
  }
}

// Форматирует профиль для ответа API
export class ProfileFormatter {
  format(u: UserRecord): PublicUser {
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      lastSeenAt: u.lastSeenAt,
      createdAt: u.createdAt,
    };
  }
}
