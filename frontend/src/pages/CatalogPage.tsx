import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomsApi } from '../api/api';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import { PublicRoomModel } from '../models';
import { useChatStore } from '../store/chatStore';
import styles from './Forms.module.css';

// Каталог публичных комнат с поиском по названию
export function CatalogPage() {
  const navigate = useNavigate();
  const myRooms = useChatStore((s) => s.rooms);
  const myRoomIds = useMemo(() => new Set(myRooms.map((r) => r.id)), [myRooms]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PublicRoomModel[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Новый поиск: сбрасываем список и грузим первую страницу
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      roomsApi
        .listPublic(query.trim(), null)
        .then((page) => {
          if (cancelled) {
            return;
          }
          setItems(page.items);
          setHasMore(page.hasMore);
          setCursor(page.nextCursor);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e instanceof ApiError ? e.message : 'Не удалось загрузить каталог');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const page = await roomsApi.listPublic(query.trim(), cursor);
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить каталог');
    } finally {
      setLoading(false);
    }
  };

  const join = async (room: PublicRoomModel) => {
    setError(null);
    try {
      await chatClient.joinPublic(room.id);
      navigate(`/rooms/${room.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти в комнату');
    }
  };

  return (
    <div className={styles.pagePlain}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Каталог комнат</h1>
        <label className={styles.field}>
          <span>Поиск по названию</span>
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
        {!loading && items.length === 0 && !error && (
          <p className={styles.hint}>Публичных комнат не найдено.</p>
        )}
        <ul className={styles.list}>
          {items.map((room) => (
            <li key={room.id} className={styles.listItem}>
              <span>{room.name}</span>
              {myRoomIds.has(room.id) ? (
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => navigate(`/rooms/${room.id}`)}
                >
                  Открыть
                </button>
              ) : (
                <button type="button" className={styles.button} onClick={() => void join(room)}>
                  Войти
                </button>
              )}
            </li>
          ))}
        </ul>
        {loading && (
          <p className={styles.hint} role="status">
            Загрузка…
          </p>
        )}
        {hasMore && !loading && (
          <button type="button" className={styles.buttonSecondary} onClick={() => void loadMore()}>
            Показать ещё
          </button>
        )}
      </div>
    </div>
  );
}
