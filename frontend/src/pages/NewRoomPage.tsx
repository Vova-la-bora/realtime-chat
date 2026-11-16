import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { chatClient } from '../chat/chatClient';
import styles from './Forms.module.css';

export function NewRoomPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('public');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      setError('Название: от 1 до 50 символов');
      return;
    }
    setBusy(true);
    try {
      const roomId = await chatClient.createRoom(trimmed, type);
      navigate(`/rooms/${roomId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать комнату');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.pagePlain}>
      <form className={styles.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 className={styles.heading}>Новая комната</h1>
        <label className={styles.field}>
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        </label>
        <fieldset className={styles.fieldset}>
          <legend>Тип</legend>
          <label className={styles.radio}>
            <input
              type="radio"
              name="type"
              value="public"
              checked={type === 'public'}
              onChange={() => setType('public')}
            />
            Публичная: видна в каталоге, войти может любой
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="type"
              value="private"
              checked={type === 'private'}
              onChange={() => setType('private')}
            />
            Приватная: только по приглашению владельца
          </label>
        </fieldset>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? 'Создаём…' : 'Создать'}
        </button>
      </form>
    </div>
  );
}
