import { useEffect, useMemo, useRef, useState } from 'react';
import { roomsApi } from '../api/api';
import { ApiError } from '../api/http';
import { dateFormatter } from '../lib/dateFormatter';
import { highlightParts } from '../lib/highlight';
import { MessageModel } from '../models';
import { useChatStore } from '../store/chatStore';
import styles from './Chat.module.css';

interface Props {
  roomId: number;
  onClose: () => void;
}

// Поиск по сообщениям комнаты: запрос уходит на сервер (полнотекстовый поиск PostgreSQL),
// результаты идут от новых к старым, дальше подгружаются кнопкой «Показать ещё»
export function SearchPanel({ roomId, onClose }: Props) {
  const members = useChatStore((s) => s.members[roomId]);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MessageModel[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Запрос, для которого показаны результаты (подсвечиваем именно его, а не то, что набрано сейчас)
  const [shownFor, setShownFor] = useState('');
  const t = useRef<number>();
  const counter = useRef(0);
  const q = query.trim();

  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members ?? []) {
      map.set(m.userId, m.displayName ?? m.username);
    }
    return map;
  }, [members]);

  // more = false: новый поиск с первой страницы, more = true: следующая страница
  const runSearch = async (text: string, more: boolean) => {
    const id = ++counter.current;
    setLoading(true);
    setError(null);
    try {
      if (more) {
        const page = await roomsApi.search(roomId, text, cursor, 20);
        if (id !== counter.current) {
          return;
        }
        const known = new Set(items.map((m) => m.id));
        setItems([...items, ...page.items.filter((m) => !known.has(m.id))]);
        setHasMore(page.hasMore);
        setCursor(page.nextCursor);
      } else {
        const res2 = await roomsApi.search(roomId, text, null, 20);
        if (id !== counter.current) {
          return;
        }
        setItems(res2.items);
        setHasMore(res2.hasMore);
        setCursor(res2.nextCursor);
        setShownFor(text);
      }
    } catch (e) {
      if (id === counter.current) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError('Не удалось выполнить поиск');
        }
      }
    } finally {
      if (id === counter.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    window.clearTimeout(t.current);
    if (q.length < 2) {
      // Слишком короткий запрос: сбрасываем результаты и игнорируем ответ, который ещё в пути
      counter.current++;
      setItems([]);
      setHasMore(false);
      setCursor(null);
      setShownFor('');
      setLoading(false);
      setError(null);
      return;
    }
    t.current = window.setTimeout(() => void runSearch(q, false), 300);
    return () => window.clearTimeout(t.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // const hint = 'Совет: возьмите фразу в кавычки или исключите слово знаком минус';

  return (
    <section className={styles.invite} aria-label="Поиск по сообщениям">
      <div className={styles.inviteHeader}>
        <strong>Поиск по сообщениям</strong>
        <button type="button" className={styles.headerButton} onClick={onClose}>
          Закрыть
        </button>
      </div>
      <input
        className={styles.inviteInput}
        type="search"
        placeholder="Слово или фраза (не короче 2 символов)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Строка поиска"
        autoFocus
      />
      {error && (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      )}
      {q.length >= 2 && !loading && !error && shownFor === q && items.length === 0 && (
        <p className={styles.notice}>Ничего не найдено</p>
      )}
      {items.length > 0 && (
        <ul className={styles.searchList} aria-label="Результаты поиска">
          {items.map((m) => (
            <li key={m.id} className={styles.searchItem}>
              <span className={styles.searchMeta}>
                {names.get(m.senderId) ?? `Пользователь ${m.senderId}`} ·{' '}
                {dateFormatter.formatDateTime(m.createdAt)}
              </span>
              <span className={styles.searchText}>
                {highlightParts(m.content, shownFor).map((part, i) =>
                  part.match ? (
                    <mark key={i} className={styles.highlight}>
                      {part.text}
                    </mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {loading && <p className={styles.notice}>Поиск…</p>}
      {hasMore && !loading && (
        <button
          type="button"
          className={styles.headerButton}
          onClick={() => void runSearch(shownFor, true)}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
