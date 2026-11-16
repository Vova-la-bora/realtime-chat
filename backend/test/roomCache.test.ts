import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomRecord } from '../src/models';
import type { RoomRepository } from '../src/repositories/roomRepository';
import type { UserRepository } from '../src/repositories/userRepository';
import type { PresenceService } from '../src/services/presenceService';
import { RoomService } from '../src/services/roomService';
import { authHeader, createRoom, createTestApp, registerUser, resetDb } from './helpers';

// Тесты кэша комнат в RoomService.getRoomOrThrow. Комментарии рядом с полем cache утверждали,
// что кэш хранит записи 5 минут (Issue #6) и что его нельзя трогать, иначе всё сломается
// (Issue #7). Тесты фиксируют, как кэш работает на самом деле. Сгруппированы по приёмам
// тестирования из книги «Совершенный код» (гл. 22.3):
//   - структурное тестирование: промах и попадание в кэш, ветка «комната не найдена»;
//   - граничные значения: время жизни записи, пустой и непустой кэш;
//   - угадывание ошибок: кэш не помнит отсутствующие комнаты и сбои, очистка кэша безопасна;
//   - моки: сколько раз и с чем вызывается репозиторий.
// Блок интеграционных тестов проходит через HTTP и настоящую БД.

function roomRecord(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return Object.assign(new RoomRecord(), {
    id: 5,
    type: 'public',
    name: 'general',
    createdBy: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

// Заглушка репозитория: findById считает вызовы и отдаёт комнаты из словаря
function createFakes(rooms: RoomRecord[] = [roomRecord()]) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const repo = {
    findById: vi.fn(async (id: number) => byId.get(id) ?? null),
  };
  const service = new RoomService(
    repo as unknown as RoomRepository,
    {} as unknown as UserRepository,
    {} as unknown as PresenceService,
  );
  return { repo, service, byId };
}

describe('RoomService.getRoomOrThrow: кэш комнат, модульные тесты', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('структурное тестирование: промах и попадание в кэш', () => {
    it('первый вызов читает комнату из репозитория и кладёт её в кэш', async () => {
      const { service, repo } = createFakes();
      expect(service.cache.size).toBe(0);
      const room = await service.getRoomOrThrow(5);
      expect(room.name).toBe('general');
      expect(repo.findById).toHaveBeenCalledTimes(1);
      expect(repo.findById).toHaveBeenCalledWith(5);
      expect(service.cache.get(5)).toBe(room);
    });

    it('повторный вызов берёт комнату из кэша, репозиторий не вызывается', async () => {
      const { service, repo } = createFakes();
      await service.getRoomOrThrow(5);
      await service.getRoomOrThrow(5);
      await service.getRoomOrThrow(5);
      expect(repo.findById).toHaveBeenCalledTimes(1);
    });

    it('разные комнаты кэшируются раздельно', async () => {
      const { service, repo } = createFakes([
        roomRecord({ id: 5 }),
        roomRecord({ id: 6, name: 'dev' }),
      ]);
      const first = await service.getRoomOrThrow(5);
      const second = await service.getRoomOrThrow(6);
      expect(first.name).toBe('general');
      expect(second.name).toBe('dev');
      await service.getRoomOrThrow(5);
      await service.getRoomOrThrow(6);
      expect(repo.findById).toHaveBeenCalledTimes(2);
      expect(service.cache.size).toBe(2);
    });

    it('несуществующая комната даёт ошибку 404 room_not_found', async () => {
      const { service } = createFakes();
      await expect(service.getRoomOrThrow(999)).rejects.toMatchObject({
        statusCode: 404,
        code: 'room_not_found',
      });
    });
  });

  describe('граничные значения: время жизни записи', () => {
    it('запись живёт дольше 5 минут: срока жизни у кэша нет', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { service, repo } = createFakes();
      await service.getRoomOrThrow(5);

      // Ровно 5 минут, чуть больше пяти минут, сутки, год
      for (const ms of [
        5 * 60 * 1000,
        5 * 60 * 1000 + 1,
        24 * 60 * 60 * 1000,
        365 * 24 * 60 * 60 * 1000,
      ]) {
        vi.advanceTimersByTime(ms);
        await service.getRoomOrThrow(5);
      }
      expect(repo.findById).toHaveBeenCalledTimes(1);
    });

    it('изменение комнаты в репозитории не видно, пока запись не удалена из кэша вручную', async () => {
      const { service, byId } = createFakes();
      const before = await service.getRoomOrThrow(5);
      byId.set(5, roomRecord({ name: 'renamed' }));

      expect((await service.getRoomOrThrow(5)).name).toBe(before.name);

      service.cache.delete(5);
      expect((await service.getRoomOrThrow(5)).name).toBe('renamed');
    });
  });

  describe('угадывание ошибок', () => {
    it('отсутствующая комната не попадает в кэш: после её появления метод её находит', async () => {
      const { service, repo, byId } = createFakes([]);
      await expect(service.getRoomOrThrow(5)).rejects.toMatchObject({ code: 'room_not_found' });
      expect(service.cache.size).toBe(0);

      byId.set(5, roomRecord());
      const room = await service.getRoomOrThrow(5);
      expect(room.id).toBe(5);
      expect(repo.findById).toHaveBeenCalledTimes(2);
    });

    it('сбой репозитория пробрасывается и ничего не кэширует: следующая попытка проходит', async () => {
      const { service, repo } = createFakes();
      const failure = new Error('БД недоступна');
      repo.findById.mockRejectedValueOnce(failure);
      await expect(service.getRoomOrThrow(5)).rejects.toBe(failure);
      expect(service.cache.size).toBe(0);

      const room = await service.getRoomOrThrow(5);
      expect(room.id).toBe(5);
    });

    it('очистка кэша безопасна: сервис продолжает работать и перечитывает комнату из репозитория', async () => {
      const { service, repo } = createFakes();
      await service.getRoomOrThrow(5);
      service.cache.clear();
      const room = await service.getRoomOrThrow(5);
      expect(room.name).toBe('general');
      expect(repo.findById).toHaveBeenCalledTimes(2);
    });

    it('из кэша отдаётся тот же объект, а не копия', async () => {
      const { service } = createFakes();
      const first = await service.getRoomOrThrow(5);
      const second = await service.getRoomOrThrow(5);
      expect(second).toBe(first);
    });
  });
});

describe('RoomService.getRoomOrThrow: через HTTP и настоящую БД', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    app.container.getRoomService().cache.clear();
  });

  it('очистка кэша ничего не ломает: комната по-прежнему доступна из БД', async () => {
    const alice = await registerUser(app, 'alice');
    const roomId = await createRoom(app, alice, 'general');
    const service = app.container.getRoomService();

    await service.getRoomOrThrow(roomId);
    expect(service.cache.has(roomId)).toBe(true);
    service.cache.clear();
    expect(service.cache.has(roomId)).toBe(false);

    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: authHeader(alice),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(service.cache.has(roomId)).toBe(true);
  });

  it('запрос членов несуществующей комнаты даёт 404 и не засоряет кэш', async () => {
    const alice = await registerUser(app, 'alice');
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/9999/members',
      headers: authHeader(alice),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('room_not_found');
    expect(app.container.getRoomService().cache.has(9999)).toBe(false);
  });
});
