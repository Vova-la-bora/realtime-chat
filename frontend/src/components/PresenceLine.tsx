import { lastSeenFormatter } from '../lib/lastSeen';
import { useChatStore } from '../store/chatStore';
import styles from './Chat.module.css';

// Статус пользователя: зелёная точка и подпись («в сети» / «был(а) …»)
export function PresenceLine({ userId }: { userId: number }) {
  const presence = useChatStore((s) => s.presence[userId]);
  const online = presence?.online ?? false;
  return (
    <span className={styles.presence}>
      <span
        className={online ? styles.dotOnline : styles.dotOffline}
        role="img"
        aria-label={online ? 'В сети' : 'Не в сети'}
      />
      {lastSeenFormatter.format(online, presence?.lastSeenAt ?? null)}
    </span>
  );
}
