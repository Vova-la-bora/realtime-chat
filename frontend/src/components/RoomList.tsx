import { useChatStore } from '../store/chatStore';
import { RoomListItem } from './RoomListItem';
import styles from './RoomList.module.css';

export function RoomList() {
  const rooms = useChatStore((s) => s.rooms);
  const loaded = useChatStore((s) => s.roomsLoaded);
  if (!loaded) {
    return (
      <p className={styles.hint} role="status">
        Загрузка комнат…
      </p>
    );
  }
  if (rooms.length === 0) {
    return (
      <p className={styles.hint}>У вас пока нет комнат. Создайте новую или найдите в каталоге.</p>
    );
  }
  return (
    <ul className={styles.list} aria-label="Ваши комнаты">
      {rooms.map((room) => (
        <RoomListItem key={room.id} room={room} />
      ))}
    </ul>
  );
}
