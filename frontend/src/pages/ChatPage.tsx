import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { chatClient } from '../chat/chatClient';
import { ChatWindow } from '../components/ChatWindow';
import { useChatStore } from '../store/chatStore';
import styles from './Forms.module.css';

export function ChatPage() {
  const params = useParams();
  const roomId = Number(params.roomId);
  const valid = Number.isInteger(roomId) && roomId > 0;
  const roomsLoaded = useChatStore((s) => s.roomsLoaded);
  const room = useChatStore((s) => s.rooms.find((r) => r.id === roomId));

  useEffect(() => {
    if (!valid) {
      return;
    }
    void chatClient.openRoom(roomId);
    return () => chatClient.closeRoom(roomId);
  }, [roomId, valid]);

  if (!valid || (roomsLoaded && !room)) {
    return (
      <div className={styles.pagePlain}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Комната не найдена</h1>
          <p className={styles.hint}>Её нет или вы не состоите в ней.</p>
          <Link to="/catalog">Открыть каталог комнат</Link>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <p className={styles.hint} role="status">
        Загрузка…
      </p>
    );
  }
  return <ChatWindow key={roomId} roomId={roomId} />;
}
