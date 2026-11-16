// Задержка перед переподключением: 1с, 2с, 4с ... максимум 30с, с джиттером (50–100% от базы)
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random() * 0.5));
}
