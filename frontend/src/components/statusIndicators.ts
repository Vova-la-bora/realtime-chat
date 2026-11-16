import { DisplayStatus } from '../models';

// Значок статуса отправки сообщения

export abstract class StatusIndicator {
  abstract symbol(): string;
  abstract cssClass(): string;
}

export class SendingIndicator extends StatusIndicator {
  symbol(): string {
    return '○';
  }
  cssClass(): string {
    return 'statusSending';
  }
}

export class SentIndicator extends StatusIndicator {
  symbol(): string {
    return '✓';
  }
  cssClass(): string {
    return 'statusSent';
  }
}

export class ReadIndicator extends StatusIndicator {
  symbol(): string {
    return '✓✓';
  }
  cssClass(): string {
    return 'statusRead';
  }
}

export class ErrorIndicator extends StatusIndicator {
  symbol(): string {
    return '!';
  }
  cssClass(): string {
    return 'statusError';
  }
}

export function createStatusIndicator(status: DisplayStatus): StatusIndicator {
  switch (status) {
    case 'sending':
      return new SendingIndicator();
    case 'sent':
      return new SentIndicator();
    case 'read':
      return new ReadIndicator();
    case 'error':
      return new ErrorIndicator();
  }
}
