import { useState } from 'react';
import { currentTheme, toggleTheme, Theme } from '../lib/theme';
import styles from './AppLayout.module.css';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={() => setTheme(toggleTheme())}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
