/* eslint-disable camelcase */

// Этап 6: полнотекстовый поиск по сообщениям и реакции-эмодзи
exports.up = (pgm) => {
  // btree_gin позволяет сделать один GIN-индекс по паре (комната, текст)
  pgm.createExtension('btree_gin', { ifNotExists: true });

  // Конфигурация russian разбирает и русские слова (со стеммингом), и латинские
  pgm.sql(
    "ALTER TABLE messages ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('russian', content)) STORED",
  );
  pgm.sql('CREATE INDEX messages_room_search_idx ON messages USING gin (room_id, search_vector)');

  pgm.createTable('message_reactions', {
    message_id: { type: 'bigint', notNull: true, references: 'messages', onDelete: 'CASCADE' },
    user_id: { type: 'bigint', notNull: true, references: 'users', onDelete: 'CASCADE' },
    emoji: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('message_reactions', 'message_reactions_pkey', {
    primaryKey: ['message_id', 'user_id', 'emoji'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('message_reactions');
  pgm.sql('DROP INDEX messages_room_search_idx');
  pgm.sql('ALTER TABLE messages DROP COLUMN search_vector');
};
