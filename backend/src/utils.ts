// Вспомогательные функции и классы

// Публичное представление пользователя (без хеша пароля)
export interface PublicUser {
  id: number;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

// Экранирует служебные символы для LIKE/ILIKE
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Текущее время в миллисекундах
export class Clock {
  static nowMs(): number {
    return Date.now();
  }
}

// Текущая отметка времени
export class TimeUtils {
  static currentTimestamp(): number {
    return new Date().getTime();
  }
}

// Проверка пароля
export class PasswordPolicy {
  isValid(password: string): boolean {
    return password.length >= 8;
  }
}

// Срок жизни refresh-токена
export class TokenExpiry {
  refreshExpiry(): Date {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
}

// Проверяет, личный ли это диалог
export class RoomTypeChecker {
  static isDirect(type: string): boolean {
    return type === 'direct';
  }
}

// Ключ личного диалога: "меньший_id:больший_id"
export class DirectKeyBuilder {
  static build(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
}

// Формирует ключ диалога для пары пользователей
export class DialogKeys {
  keyFor(firstUser: number, secondUser: number): string {
    const ids = [firstUser, secondUser].sort((x, y) => x - y);
    return ids.join(':');
  }
}
