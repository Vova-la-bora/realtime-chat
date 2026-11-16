import { useChatStore } from '../store/chatStore';
import styles from './Chat.module.css';

// Строка «X печатает…» над полем ввода
export function TypingIndicator({ roomId }: { roomId: number }) {
  const typing = useChatStore((s) => s.typing[roomId]);
  const members = useChatStore((s) => s.members[roomId]);
  const ids = typing ?? [];
  const names = ids.map((id) => {
    const member = members?.find((m) => m.userId === id);
    return member ? (member.displayName ?? member.username) : `Пользователь ${id}`;
  });
  let text = '';
  if (names.length === 1) {
    text = `${names[0]} печатает…`;
  } else if (names.length === 2) {
    text = `${names[0]} и ${names[1]} печатают…`;
  } else if (names.length > 2) {
    text = 'Несколько человек печатают…';
  }
  return (
    <div className={styles.typing} role="status" aria-live="polite">
      {text}
    </div>
  );
}
