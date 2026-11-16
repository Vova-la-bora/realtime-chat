import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerRow, RoomListRow, RoomRepository } from '../src/repositories/roomRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { PresenceService } from '../src/services/presenceService';
import { RoomService } from '../src/services/roomService';
import { authHeader, createRoom, createTestApp, registerUser, resetDb } from './helpers';

// Тесты метода RoomService.listForUser (список комнат пользователя). Сгруппированы по приёмам
// тестирования из книги «Совершенный код» (гл. 22.3):
//   - граничные значения;
//   - классы данных: типы комнат и варианты заголовка;
//   - структурное тестирование: каждая ветка метода хотя бы раз;
//   - угадывание ошибок;
//   - моки: проверка вызовов репозитория (сколько раз и с чем).
// Модульные тесты работают с заглушками вместо БД, последний блок идёт через HTTP и настоящую БД.

function roomRow(overrides: Partial<RoomListRow> = {}): RoomListRow {
  return {
    id: 1,
    type: 'public',
    name: 'general',
    created_by: 1,
    created_at: new Date('2026-01-01T00:00:00Z'),
    role: 'member',
    last_read_message_id: 0,
    last_message_id: null,
    last_content: null,
    last_sender_id: null,
    last_created_at: null,
    last_deleted_at: null,
    unread: 0,
    ...overrides,
  };
}

function peerRow(overrides: Partial<PeerRow> = {}): PeerRow {
  return {
    room_id: 2,
    id: 9,
    username: 'bob',
    display_name: 'Боб',
    avatar_url: 'http://example.com/bob.png',
    ...overrides,
  };
}

// Заглушки репозитория: vi.fn() запоминает вызовы, поэтому ими можно проверять поведение
function createFakes(rows: RoomListRow[], peers: PeerRow[] = []) {
  const repo = {
    listForUser: vi.fn().mockResolvedValue(rows),
    listPeers: vi.fn().mockResolvedValue(peers),
  };
  const service = new RoomService(
    repo as unknown as RoomRepository,
    {} as unknown as UserRepository,
    {} as unknown as PresenceService,
  );
  return { repo, service };
}

describe('RoomService.listForUser: модульные тесты с заглушками', () => {
  describe('граничные значения', () => {
    it('нет комнат: пустой список, собеседники не запрашиваются', async () => {
      const { service, repo } = createFakes([]);
      expect(await service.listForUser(5)).toEqual([]);
      expect(repo.listForUser).toHaveBeenCalledTimes(1);
      expect(repo.listForUser).toHaveBeenCalledWith(5);
      expect(repo.listPeers).not.toHaveBeenCalled();
    });

    it('одна комната: в списке ровно один элемент со всеми полями', async () => {
      const { service } = createFakes([roomRow({ id: 3, role: 'owner', unread: 4 })]);
      const result = await service.listForUser(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 3,
        type: 'public',
        title: 'general',
        role: 'owner',
        unread: 4,
        peer: null,
        lastMessage: null,
      });
    });

    it('счётчик непрочитанных передаётся как есть: 0 и очень большое значение', async () => {
      const { service } = createFakes([
        roomRow({ id: 1, unread: 0 }),
        roomRow({ id: 2, unread: 1000 }),
      ]);
      const result = await service.listForUser(1);
      expect(result.map((r) => r.unread)).toEqual([0, 1000]);
    });
  });

  describe('классы данных: типы комнат и заголовок', () => {
    it('публичная и приватная комнаты показываются под своим названием', async () => {
      const { service } = createFakes([
        roomRow({ id: 1, type: 'public', name: 'Открытая' }),
        roomRow({ id: 2, type: 'private', name: 'Закрытая' }),
      ]);
      const result = await service.listForUser(1);
      expect(result.map((r) => r.title)).toEqual(['Открытая', 'Закрытая']);
    });

    it('у группы без названия заголовок «Без названия»', async () => {
      const { service } = createFakes([roomRow({ name: null })]);
      const result = await service.listForUser(1);
      expect(result[0].title).toBe('Без названия');
    });

    it('личный диалог: заголовок это отображаемое имя собеседника, данные собеседника перенесены', async () => {
      const { service } = createFakes(
        [roomRow({ id: 2, type: 'direct', name: null })],
        [peerRow()],
      );
      const result = await service.listForUser(1);
      expect(result[0].title).toBe('Боб');
      expect(result[0].peer).toEqual({
        id: 9,
        username: 'bob',
        displayName: 'Боб',
        avatarUrl: 'http://example.com/bob.png',
      });
    });

    it('личный диалог: без отображаемого имени заголовок это username', async () => {
      const { service } = createFakes(
        [roomRow({ id: 2, type: 'direct', name: null })],
        [peerRow({ display_name: null })],
      );
      const result = await service.listForUser(1);
      expect(result[0].title).toBe('bob');
    });

    it('личный диалог, собеседник не найден: заголовок «Личный диалог», peer = null', async () => {
      const { service } = createFakes([roomRow({ id: 2, type: 'direct', name: null })], []);
      const result = await service.listForUser(1);
      expect(result[0].title).toBe('Личный диалог');
      expect(result[0].peer).toBeNull();
    });
  });

  describe('структурное тестирование: ветки метода', () => {
    it('смешанный список: порядок как у репозитория, у каждого диалога свой собеседник', async () => {
      const { service } = createFakes(
        [
          roomRow({ id: 10, type: 'public', name: 'Общая' }),
          roomRow({ id: 20, type: 'direct', name: null }),
          roomRow({ id: 30, type: 'private', name: 'Тайная' }),
          roomRow({ id: 40, type: 'direct', name: null }),
        ],
        [
          peerRow({ room_id: 20, id: 100, username: 'anna', display_name: 'Анна' }),
          peerRow({ room_id: 40, id: 200, username: 'petr', display_name: null }),
        ],
      );
      const result = await service.listForUser(1);
      expect(result.map((r) => r.id)).toEqual([10, 20, 30, 40]);
      expect(result.map((r) => r.title)).toEqual(['Общая', 'Анна', 'Тайная', 'petr']);
      expect(result.map((r) => r.peer?.id ?? null)).toEqual([null, 100, null, 200]);
    });

    it('последнего сообщения нет: lastMessage = null', async () => {
      const { service } = createFakes([roomRow({ last_message_id: null })]);
      const result = await service.listForUser(1);
      expect(result[0].lastMessage).toBeNull();
    });

    it('последнее сообщение переносится в ответ', async () => {
      const sentAt = new Date('2026-03-01T10:00:00Z');
      const { service } = createFakes([
        roomRow({
          last_message_id: 55,
          last_content: 'Привет',
          last_sender_id: 8,
          last_created_at: sentAt,
        }),
      ]);
      const result = await service.listForUser(1);
      expect(result[0].lastMessage).toEqual({
        id: 55,
        senderId: 8,
        content: 'Привет',
        createdAt: sentAt,
      });
    });

    it('удалённое последнее сообщение показывается заглушкой, текст не раскрывается', async () => {
      const { service } = createFakes([
        roomRow({
          last_message_id: 55,
          last_content: 'Секрет',
          last_sender_id: 8,
          last_created_at: new Date('2026-03-01T10:00:00Z'),
          last_deleted_at: new Date('2026-03-01T11:00:00Z'),
        }),
      ]);
      const result = await service.listForUser(1);
      expect(result[0].lastMessage?.content).toBe('сообщение удалено');
    });
  });

  describe('угадывание ошибок', () => {
    it('пустые поля последнего сообщения заменяются значениями по умолчанию', async () => {
      const { service } = createFakes([
        roomRow({
          last_message_id: 55,
          last_content: null,
          last_sender_id: null,
          last_created_at: null,
        }),
      ]);
      const result = await service.listForUser(1);
      expect(result[0].lastMessage).toEqual({
        id: 55,
        senderId: 0,
        content: '',
        createdAt: new Date(0),
      });
    });

    it('неизвестный тип комнаты вызывает ошибку, а не молчаливый пропуск', async () => {
      const { service } = createFakes([roomRow({ type: 'channel' })]);
      await expect(service.listForUser(1)).rejects.toThrow('Неизвестный тип комнаты: channel');
    });

    it('ошибка репозитория пробрасывается без изменений', async () => {
      const { service, repo } = createFakes([roomRow({ id: 2, type: 'direct', name: null })]);
      const failure = new Error('БД недоступна');
      repo.listPeers.mockRejectedValue(failure);
      await expect(service.listForUser(1)).rejects.toBe(failure);
    });
  });

  describe('моки: проверка взаимодействия с репозиторием', () => {
    it('только группы: собеседники не запрашиваются совсем', async () => {
      const { service, repo } = createFakes([
        roomRow({ id: 1, type: 'public' }),
        roomRow({ id: 2, type: 'private' }),
      ]);
      await service.listForUser(1);
      expect(repo.listPeers).toHaveBeenCalledTimes(0);
    });

    it('несколько диалогов: собеседники запрашиваются одним вызовом, только по id диалогов', async () => {
      const { service, repo } = createFakes(
        [
          roomRow({ id: 10, type: 'public' }),
          roomRow({ id: 20, type: 'direct', name: null }),
          roomRow({ id: 40, type: 'direct', name: null }),
        ],
        [peerRow({ room_id: 20 }), peerRow({ room_id: 40, id: 10 })],
      );
      await service.listForUser(77);
      expect(repo.listPeers).toHaveBeenCalledTimes(1);
      expect(repo.listPeers).toHaveBeenCalledWith([20, 40], 77);
    });
  });
});

describe('RoomService.listForUser: через HTTP и настоящую БД', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    // После сброса БД id комнат начинаются заново, поэтому кэш комнат тоже очищается
    app.container.getRoomService().cache.clear();
  });

  it('созданная группа появляется в списке владельца с ролью owner', async () => {
    const alice = await registerUser(app, 'alice');
    const roomId = await createRoom(app, alice, 'general');
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(alice) });
    expect(res.statusCode).toBe(200);
    const room = res.json().items.find((r: { id: number }) => r.id === roomId);
    expect(room).toMatchObject({ title: 'general', role: 'owner', unread: 0, lastMessage: null });
  });

  it('личный диалог у собеседника называется именем автора и содержит данные автора', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const opened = await app.inject({
      method: 'POST',
      url: '/api/rooms/direct',
      headers: authHeader(alice),
      payload: { userId: bob.id },
    });
    const directId = opened.json().room.id;
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: authHeader(bob) });
    const room = res.json().items.find((r: { id: number }) => r.id === directId);
    expect(room).toMatchObject({ type: 'direct', title: 'alice' });
    expect(room.peer).toMatchObject({ id: alice.id, username: 'alice' });
  });
});
