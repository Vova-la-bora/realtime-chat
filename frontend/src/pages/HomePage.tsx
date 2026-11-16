import styles from './Forms.module.css';

// Стартовая страница: на широких экранах подсказка, на узких вместо неё виден список комнат
export function HomePage() {
  return (
    <div className={styles.placeholder}>
      <p>Выберите комнату слева, создайте новую или найдите интересную в каталоге.</p>
    </div>
  );
}
