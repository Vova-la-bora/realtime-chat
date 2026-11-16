import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '../api/api';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import { Avatar } from '../components/Avatar';
import { FoundUserModel } from '../models';
import styles from './Forms.module.css';

// Новый личный диалог: ищем пользователя и открываем диалог с ним
export function NewDirectPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundUserModel[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      usersApi
        .search(q)
        .then((found) => {
          if (!cancelled) {
            setResults(found);
            setSearched(true);
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

  const open = async (user: FoundUserModel) => {
    setError(null);
    try {
      const roomId = await chatClient.openDirect(user.id);
      navigate(`/rooms/${roomId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось открыть диалог');
    }
  };

  return (
    <div className={styles.pagePlain}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Личное сообщение</h1>
        <label className={styles.field}>
          <span>Имя пользователя</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {searched && results.length === 0 && <p className={styles.hint}>Никого не нашли.</p>}
        <ul className={styles.list}>
          {results.map((user) => (
            <li key={user.id} className={styles.listItem}>
              <span className={styles.profileHead}>
                <Avatar name={user.displayName ?? user.username} url={user.avatarUrl} size={32} />
                <span>
                  {user.displayName ?? user.username}
                  <span className={styles.hint}> @{user.username}</span>
                </span>
              </span>
              <button type="button" className={styles.button} onClick={() => void open(user)}>
                Написать
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
