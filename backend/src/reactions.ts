// Допустимые реакции: фиксированный набор, чтобы в БД и в интерфейс не попадали произвольные строки
export const ALLOWED_REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🎉', '🔥'] as const;

export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];
