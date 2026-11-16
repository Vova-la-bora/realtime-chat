import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { cx } from '../lib/cx';
import { useAuthStore } from '../store/authStore';
import { Avatar } from './Avatar';
import { ConnectionBanner } from './ConnectionBanner';
import { RoomList } from './RoomList';
import { ThemeToggle } from './ThemeToggle';
import styles from './AppLayout.module.css';

// Каркас приложения: слева список комнат, справа текущая страница
export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { pathname } = useLocation();
  // На узких экранах показываем либо список комнат, либо содержимое страницы
  const hasChild = pathname !== '/';
  const name = user?.displayName ?? user?.username ?? '';

  return (
    <div className={cx(styles.root, hasChild && styles.hasChild)}>
      <a href="#main" className="skipLink">
        Перейти к содержимому
      </a>
      <aside className={styles.sidebar} aria-label="Навигация и комнаты">
        <header className={styles.header}>
          <Link to="/profile" className={styles.me} aria-label="Мой профиль">
            <Avatar name={name} url={user?.avatarUrl} size={36} />
            <span className={styles.meName}>{name}</span>
          </Link>
          <ThemeToggle />
          <button type="button" className={styles.iconButton} onClick={() => void logout()}>
            Выйти
          </button>
        </header>
        <nav className={styles.nav} aria-label="Разделы">
          <NavLink
            to="/rooms/new"
            className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
          >
            Новая комната
          </NavLink>
          <NavLink
            to="/dialogs/new"
            className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
          >
            Личное сообщение
          </NavLink>
          <NavLink
            to="/catalog"
            className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
          >
            Каталог
          </NavLink>
        </nav>
        <RoomList />
      </aside>
      <main id="main" tabIndex={-1} className={styles.content}>
        <ConnectionBanner />
        <Outlet />
      </main>
    </div>
  );
}
