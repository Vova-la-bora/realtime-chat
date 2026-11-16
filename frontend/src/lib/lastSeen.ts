// Подпись о присутствии: «в сети» или «был(а) в сети …»
export class LastSeenFormatter {
  format(online: boolean, lastSeenAt: string | null): string {
    if (online) {
      return 'в сети';
    }
    if (!lastSeenAt) {
      return 'не в сети';
    }
    const d = new Date(lastSeenAt);
    const now = new Date();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) {
      return `был(а) сегодня в ${time}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `был(а) вчера в ${time}`;
    }
    return `был(а) ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
  }
}

export const lastSeenFormatter = new LastSeenFormatter();
