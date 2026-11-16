import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { chatClient } from '../chat/chatClient';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { MessageBubble } from './MessageBubble';
import styles from './Chat.module.css';

// Список сообщений с бесконечной прокруткой вверх.
// При подгрузке старых сообщений позиция прокрутки сохраняется.
export function MessageList({ roomId }: { roomId: number }) {
  const bucket = useChatStore((s) => s.messages[roomId]);
  const members = useChatStore((s) => s.members[roomId]);
  const meId = useAuthStore((s) => s.user?.id);
  // В личном диалоге известно, до какого сообщения дочитал собеседник
  const room = useChatStore((s) => s.rooms.find((r) => r.id === roomId));
  const peerRead = useChatStore((s) =>
    room?.type === 'direct' && room.peer ? (s.reads[roomId]?.[room.peer.id] ?? 0) : 0,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  // Высота и положение прокрутки до подгрузки старых сообщений
  const restore = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  const lastKey = useRef('');

  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members ?? []) {
      map.set(m.userId, m.displayName ?? m.username);
    }
    return map;
  }, [members]);

  const items = bucket?.items;
  const loading = bucket?.loading ?? false;
  const hasMore = bucket?.hasMore ?? false;
  const failed = bucket?.error != null;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !items) {
      return;
    }
    const last = items[items.length - 1];
    const key = last ? `${last.senderId}:${last.clientMsgId}` : '';
    if (restore.current && !loading) {
      // Старые сообщения добавились сверху: возвращаем прежнее положение
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (key !== lastKey.current && last?.senderId === meId && last?.id === null) {
      // Пользователь отправил своё сообщение: прокручиваем к нему
      stickToBottom.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    lastKey.current = key;
  }, [items, loading, meId]);

  // Если сообщений мало и прокрутки нет, догружаем историю сами
  useEffect(() => {
    const el = containerRef.current;
    if (
      el &&
      bucket?.loaded &&
      hasMore &&
      !loading &&
      !failed &&
      el.scrollHeight <= el.clientHeight
    ) {
      void chatClient.loadOlder(roomId);
    }
  }, [bucket?.loaded, hasMore, loading, failed, items, roomId]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 80 && hasMore && !loading && !failed) {
      restore.current = { height: el.scrollHeight, top: el.scrollTop };
      void chatClient.loadOlder(roomId);
    }
  };

  const retryLoading = () => {
    if (bucket?.loaded) {
      void chatClient.loadOlder(roomId);
    } else {
      void chatClient.loadLatest(roomId);
    }
  };

  return (
    <div
      ref={containerRef}
      className={styles.scroller}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Сообщения"
    >
      {!bucket?.loaded && loading && <p className={styles.notice}>Загрузка сообщений…</p>}
      {bucket?.loaded && hasMore && loading && <p className={styles.notice}>Загрузка истории…</p>}
      {bucket?.error && (
        <p className={styles.noticeError} role="alert">
          {bucket.error}{' '}
          <button type="button" className={styles.retry} onClick={retryLoading}>
            Повторить
          </button>
        </p>
      )}
      {bucket?.loaded && items?.length === 0 && (
        <p className={styles.notice}>Сообщений пока нет. Напишите первым!</p>
      )}
      <ul className={styles.list}>
        {items?.map((m) => (
          <MessageBubble
            key={`${m.senderId}:${m.clientMsgId}`}
            message={m}
            own={m.senderId === meId}
            senderName={names.get(m.senderId) ?? `Пользователь ${m.senderId}`}
            read={m.senderId === meId && m.id !== null && m.id <= peerRead}
            meId={meId}
            nameOf={(userId) =>
              userId === meId ? 'Вы' : (names.get(userId) ?? `Пользователь ${userId}`)
            }
            onRetry={(clientMsgId) => chatClient.retryMessage(roomId, clientMsgId)}
            onEdit={(messageId, content) => chatClient.editMessage(messageId, content)}
            onDelete={(messageId) => chatClient.deleteMessage(messageId)}
            onReact={(messageId, emoji) => chatClient.toggleReaction(messageId, emoji)}
          />
        ))}
      </ul>
    </div>
  );
}
