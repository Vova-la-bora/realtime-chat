import { DisplayStatus } from '../models';

// Подписи статуса отправки сообщения (подсказка и текст для скринридеров)

export abstract class StatusLabel {
  abstract text(): string;
  abstract ariaLabel(): string;
}

export class SendingLabel extends StatusLabel {
  text(): string {
    return 'Отправляется…';
  }
  ariaLabel(): string {
    return 'Сообщение отправляется';
  }
}

export class SentLabel extends StatusLabel {
  text(): string {
    return 'Отправлено';
  }
  ariaLabel(): string {
    return 'Сообщение отправлено';
  }
}

export class ReadLabel extends StatusLabel {
  text(): string {
    return 'Прочитано';
  }
  ariaLabel(): string {
    return 'Сообщение прочитано собеседником';
  }
}

export class ErrorLabel extends StatusLabel {
  text(): string {
    return 'Ошибка отправки';
  }
  ariaLabel(): string {
    return 'Не удалось отправить сообщение';
  }
}

export function createStatusLabel(status: DisplayStatus): StatusLabel {
  switch (status) {
    case 'sending':
      return new SendingLabel();
    case 'sent':
      return new SentLabel();
    case 'read':
      return new ReadLabel();
    case 'error':
      return new ErrorLabel();
  }
}
