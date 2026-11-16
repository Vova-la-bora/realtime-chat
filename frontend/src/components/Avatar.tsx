import { useState } from 'react';
import styles from './Avatar.module.css';

interface Props {
  name: string;
  url?: string | null;
  size?: number;
}

// Аватар: картинка по URL или круг с первой буквой имени
export function Avatar({ name, url, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        className={styles.avatar}
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    );
  }
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span
      className={styles.avatar}
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
    </span>
  );
}
