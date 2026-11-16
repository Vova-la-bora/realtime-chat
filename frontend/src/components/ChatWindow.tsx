import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import { useChatStore } from '../store/chatStore';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { InvitePanel } from './InvitePanel';
import { MembersPanel } from './MembersPanel';
import { MessageList } from './MessageList';
import { PresenceLine } from './PresenceLine';
import { SearchPanel } from './SearchPanel';
import { TypingIndicator } from './TypingIndicator';
import styles from './Chat.module.css';

function kindLabel(type: string): string {
  if (type === 'public') {
    return 'Публичная комната';
  }
  if (type === 'private') {
    return 'Приватная комната';
  }
  return 'Личный диалог';
}

export function ChatWindow({ roomId }: { roomId: number }) {
  const room = useChatStore((s) => s.rooms.find((r) => r.id === roomId));
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!room) {
    return null;
  }
  const isDirect = room.type === 'direct';
  const canInvite = room.role === 'owner' && !isDirect;

  const handleLeave = async () => {
    if (!window.confirm(`Выйти из комнаты «${room.title}»?`)) {
      return;
    }
    try {
      await chatClient.leaveRoom(roomId);
      navigate('/');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Не удалось выйти из комнаты');
    }
  };

  return (
    <section className={styles.window} aria-label={`Чат: ${room.title}`}>
      <header className={styles.header}>
        <Link to="/" className={styles.back} aria-label="К списку комнат">
          ←
        </Link>
        <Avatar name={room.title} url={room.peer?.avatarUrl} />
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{room.title}</h1>
          <span className={styles.subtitle}>
            {isDirect && room.peer ? <PresenceLine userId={room.peer.id} /> : kindLabel(room.type)}
          </span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => setSearchOpen((open) => !open)}
            aria-expanded={searchOpen}
          >
            Поиск
          </button>
          {!isDirect && (
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => setMembersOpen((open) => !open)}
              aria-expanded={membersOpen}
            >
              Участники
            </button>
          )}
          {canInvite && (
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => setInviteOpen((open) => !open)}
              aria-expanded={inviteOpen}
            >
              Пригласить
            </button>
          )}
          {!isDirect && (
            <button
              type="button"
              className={styles.headerButton}
              onClick={() => void handleLeave()}
            >
              Выйти
            </button>
          )}
        </div>
      </header>
      {actionError && (
        <p className={styles.noticeError} role="alert">
          {actionError}
        </p>
      )}
      {searchOpen && (
        <SearchPanel key={roomId} roomId={roomId} onClose={() => setSearchOpen(false)} />
      )}
      {membersOpen && <MembersPanel roomId={roomId} onClose={() => setMembersOpen(false)} />}
      {inviteOpen && <InvitePanel roomId={roomId} onClose={() => setInviteOpen(false)} />}
      <MessageList roomId={roomId} />
      <TypingIndicator roomId={roomId} />
      <Composer roomId={roomId} />
    </section>
  );
}
