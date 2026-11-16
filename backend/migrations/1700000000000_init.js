/* eslint-disable camelcase */

// Начальная схема БД: пользователи, токены, комнаты, участники, сообщения
exports.up = (pgm) => {
  pgm.createExtension('pg_trgm', { ifNotExists: true });

  pgm.createTable('users', {
    id: { type: 'bigserial', primaryKey: true },
    username: { type: 'varchar(20)', notNull: true, unique: true },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    display_name: { type: 'varchar(50)' },
    avatar_url: { type: 'text' },
    last_seen_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('refresh_tokens', {
    id: { type: 'bigserial', primaryKey: true },
    user_id: { type: 'bigint', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('refresh_tokens', 'token_hash', { unique: true });
  pgm.createIndex('refresh_tokens', 'user_id');

  pgm.createTable('rooms', {
    id: { type: 'bigserial', primaryKey: true },
    type: { type: 'text', notNull: true, check: "type IN ('public','private','direct')" },
    name: { type: 'varchar(50)' },
    created_by: { type: 'bigint', references: 'users' },
    direct_key: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Триграммный индекс для поиска по названию в каталоге (ILIKE '%...%')
  pgm.sql('CREATE INDEX rooms_name_trgm_idx ON rooms USING gin (name gin_trgm_ops)');

  pgm.createTable('room_members', {
    room_id: { type: 'bigint', notNull: true, references: 'rooms', onDelete: 'CASCADE' },
    user_id: { type: 'bigint', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'member', check: "role IN ('owner','member')" },
    last_read_message_id: { type: 'bigint', notNull: true, default: 0 },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('room_members', 'room_members_pkey', { primaryKey: ['room_id', 'user_id'] });
  pgm.createIndex('room_members', 'user_id');

  pgm.createTable('messages', {
    id: { type: 'bigserial', primaryKey: true },
    room_id: { type: 'bigint', notNull: true, references: 'rooms', onDelete: 'CASCADE' },
    sender_id: { type: 'bigint', notNull: true, references: 'users' },
    client_msg_id: { type: 'uuid', notNull: true },
    content: { type: 'text', notNull: true, check: 'char_length(content) BETWEEN 1 AND 4000' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    edited_at: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('messages', 'messages_sender_client_msg_unique', {
    unique: ['sender_id', 'client_msg_id'],
  });
  // Индекс для курсорной пагинации истории
  pgm.sql('CREATE INDEX messages_room_id_id_desc_idx ON messages (room_id, id DESC)');
};

exports.down = (pgm) => {
  pgm.dropTable('messages');
  pgm.dropTable('room_members');
  pgm.dropTable('rooms');
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('users');
};
