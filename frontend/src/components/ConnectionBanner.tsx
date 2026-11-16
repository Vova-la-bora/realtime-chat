import { useChatStore } from '../store/chatStore';
import styles from './AppLayout.module.css';

// Состояние соединения и общие уведомления
export function ConnectionBanner() {
  const connection = useChatStore((s) => s.connection);
  const notice = useChatStore((s) => s.notice);
  const setNotice = useChatStore((s) => s.setNotice);
  return (
    <>
      {connection !== 'online' && (
        <div className={styles.banner} role="status">
          {connection === 'connecting'
            ? 'Подключение…'
            : 'Нет соединения. Пытаемся подключиться снова…'}
        </div>
      )}
      {notice && (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setNotice(null)}
            aria-label="Закрыть уведомление"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
