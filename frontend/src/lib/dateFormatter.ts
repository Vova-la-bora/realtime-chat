// Форматирование времени сообщения
export class DateFormatter {
  private timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

  private dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  formatTime(iso: string): string {
    return this.timeFormat.format(new Date(iso));
  }

  // Дата и время целиком: для результатов поиска, где сообщения из разных дней
  formatDateTime(iso: string): string {
    return this.dateTimeFormat.format(new Date(iso));
  }
}

export const dateFormatter = new DateFormatter();
