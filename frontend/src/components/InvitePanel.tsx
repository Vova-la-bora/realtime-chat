import { useEffect, useState } from 'react';
import { roomsApi, usersApi } from '../api/api';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import { FoundUserModel } from '../models';
import { Avatar } from './Avatar';
import styles from './Chat.module.css';

interface Props {
  roomId: number;
  onClose: () => void;
}

// Приглашение пользователя в комнату (доступно владельцу)
export function InvitePanel({ roomId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundUserModel[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      usersApi
        .search(q)
        .then((found) => {
          if (!cancelled) {
            setResults(found);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e instanceof ApiError ? e.message : 'Не удалось выполнить поиск');
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const invite = async (user: FoundUserModel) => {
    setError(null);
    setMessage(null);
    try {
      await roomsApi.invite(roomId, user.id);
      setMessage(`${user.displayName ?? user.username} добавлен(а) в комнату`);
      void chatClient.loadMembers(roomId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось пригласить');
    }
  };

  return (
    <section className={styles.invite} aria-label="Приглашение в комнату">
      <div className={styles.inviteHeader}>
        <strong>Пригласить пользователя</strong>
        <button type="button" className={styles.headerButton} onClick={onClose}>
          Закрыть
        </button>
      </div>
      <label className="srOnly" htmlFor="invite-query">
        Имя пользователя
      </label>
      <input
        id="invite-query"
        className={styles.inviteInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по имени пользователя"
        autoComplete="off"
      />
      {error && (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      <ul className={styles.inviteList}>
        {results.map((user) => (
          <li key={user.id} className={styles.inviteItem}>
            <Avatar name={user.displayName ?? user.username} url={user.avatarUrl} size={32} />
            <span className={styles.inviteName}>
              {user.displayName ?? user.username}
              <small> @{user.username}</small>
            </span>
            <button type="button" className={styles.headerButton} onClick={() => void invite(user)}>
              Пригласить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
