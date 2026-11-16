import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { Avatar } from './Avatar';
import { PresenceLine } from './PresenceLine';
import styles from './Chat.module.css';

interface Props {
  roomId: number;
  onClose: () => void;
}

// Участники комнаты с их статусами; отсюда можно открыть личный диалог
export function MembersPanel({ roomId, onClose }: Props) {
  const navigate = useNavigate();
  const members = useChatStore((s) => s.members[roomId]);
  const setNotice = useChatStore((s) => s.setNotice);
  const meId = useAuthStore((s) => s.user?.id);

  const writeTo = async (userId: number) => {
    try {
      const directId = await chatClient.openDirect(userId);
      navigate(`/rooms/${directId}`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Не удалось открыть диалог');
    }
  };

  return (
    <section className={styles.invite} aria-label="Участники комнаты">
      <div className={styles.inviteHeader}>
        <strong>Участники ({members?.length ?? 0})</strong>
        <button type="button" className={styles.headerButton} onClick={onClose}>
          Закрыть
        </button>
      </div>
      <ul className={styles.inviteList}>
        {members?.map((m) => (
          <li key={m.userId} className={styles.inviteItem}>
            <Avatar name={m.displayName ?? m.username} url={m.avatarUrl} size={32} />
            <span className={styles.inviteName}>
              {m.displayName ?? m.username}
              {m.role === 'owner' && <small> владелец</small>}
              <br />
              <small>
                <PresenceLine userId={m.userId} />
              </small>
            </span>
            {m.userId !== meId && (
              <button
                type="button"
                className={styles.headerButton}
                onClick={() => void writeTo(m.userId)}
              >
                Написать
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
