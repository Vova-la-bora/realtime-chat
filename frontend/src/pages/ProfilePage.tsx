import { FormEvent, useState } from 'react';
import { usersApi } from '../api/api';
import { ApiError } from '../api/http';
import { Avatar } from '../components/Avatar';
import { useAuthStore } from '../store/authStore';
import styles from './Forms.module.css';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) {
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const name = displayName.trim();
    if (name.length === 0 || name.length > 50) {
      setError('Отображаемое имя: от 1 до 50 символов');
      return;
    }
    setBusy(true);
    try {
      const updated = await usersApi.updateMe({
        displayName: name,
        avatarUrl: avatarUrl.trim() === '' ? null : avatarUrl.trim(),
      });
      setUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.pagePlain}>
      <form className={styles.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 className={styles.heading}>Профиль</h1>
        <div className={styles.profileHead}>
          <Avatar name={displayName || user.username} url={avatarUrl.trim() || null} size={64} />
          <div>
            <strong>@{user.username}</strong>
            <div className={styles.hint}>{user.email}</div>
          </div>
        </div>
        <label className={styles.field}>
          <span>Отображаемое имя</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Ссылка на аватар (URL)</span>
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className={styles.success} role="status">
            Профиль сохранён
          </p>
        )}
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
    </div>
  );
}
