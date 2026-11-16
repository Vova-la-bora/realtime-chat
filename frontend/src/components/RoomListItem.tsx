import { NavLink } from 'react-router-dom';
import { TimeLabels } from '../lib/timeLabels';
import { cx } from '../lib/cx';
import { RoomModel } from '../models';
import { useAuthStore } from '../store/authStore';
import { Avatar } from './Avatar';
import styles from './RoomList.module.css';

export function RoomListItem({ room }: { room: RoomModel }) {
  const meId = useAuthStore((s) => s.user?.id);
  const last = room.lastMessage;
  const preview = last
    ? `${last.senderId === meId ? 'Вы: ' : ''}${last.content}`
    : 'Сообщений пока нет';
  return (
    <li>
      <NavLink
        to={`/rooms/${room.id}`}
        className={({ isActive }) => cx(styles.item, isActive && styles.itemActive)}
      >
        <Avatar name={room.title} url={room.peer?.avatarUrl} />
        <span className={styles.body}>
          <span className={styles.topRow}>
            <span className={styles.title}>{room.title}</span>
            {last && <time className={styles.time}>{TimeLabels.short(last.createdAt)}</time>}
          </span>
          <span className={styles.bottomRow}>
            <span className={styles.preview}>{preview}</span>
            {room.unread > 0 && (
              <span className={styles.badge} aria-label={`Непрочитанных: ${room.unread}`}>
                {room.unread > 99 ? '99+' : room.unread}
              </span>
            )}
          </span>
        </span>
      </NavLink>
    </li>
  );
}
