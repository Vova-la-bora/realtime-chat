import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db';
import { RoomRepository } from '../src/repositories/roomRepository';
import { resetDb } from './helpers';

// Тесты RoomRepository.listPublic: каталог публичных комнат. Порядок выдачи: от новых комнат
// к старым (по id), потому что на нём построен курсор («id меньше курсора»). Тесты
// сгруппированы по приёмам тестирования из книги «Совершенный код» (гл. 22.3):
//   - граничные значения: пустой каталог, курсор и лимит на границах;
//   - классы данных: типы комнат, регистр и спецсимволы в поиске;
//   - структурное тестирование: все сочетания условий запроса (поиск, курсор);
//   - угадывание ошибок: символы % и _ в запросе, страницы без повторов и пропусков;
//   - моки: проверка SQL и параметров, которые уходят в БД.

describe('RoomRepository.listPublic: через настоящую БД', () => {
  const repo = new RoomRepository(pool);
  let ownerId: number;

  async function publicRoom(name: string) {
    return repo.createGroup('public', name, ownerId);
  }

  beforeEach(async () => {
    await resetDb();
    const owner = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES ('owner', 'owner@example.com', 'x') RETURNING id",
    );
    ownerId = owner.rows[0].id;
  });

  describe('граничные значения', () => {
    it('нет комнат: пустой список', async () => {
      expect(await repo.listPublic('', null, 20)).toEqual([]);
    });

    it('курсор равен id самой старой комнаты: больше ничего нет', async () => {
      const oldest = await publicRoom('Первая');
      await publicRoom('Вторая');
      expect(await repo.listPublic('', oldest.id, 20)).toEqual([]);
    });

    it('курсор больше всех id: возвращаются все комнаты', async () => {
      await publicRoom('Первая');
      const newest = await publicRoom('Вторая');
      const result = await repo.listPublic('', newest.id + 1, 20);
      expect(result).toHaveLength(2);
    });

    it('лимит 1 даёт самую новую комнату, лимит 0 даёт пустой список, лимит больше числа комнат даёт все', async () => {
      await publicRoom('Первая');
      const newest = await publicRoom('Вторая');
      expect((await repo.listPublic('', null, 1)).map((r) => r.id)).toEqual([newest.id]);
      expect(await repo.listPublic('', null, 0)).toEqual([]);
      expect(await repo.listPublic('', null, 100)).toHaveLength(2);
    });
  });

  describe('порядок и классы данных', () => {
    it('комнаты идут от новых к старым по id, а не по алфавиту', async () => {
      await publicRoom('Яблоко');
      await publicRoom('Арбуз');
      await publicRoom('Мандарин');
      const names = (await repo.listPublic('', null, 20)).map((r) => r.name);
      // По алфавиту было бы «Арбуз, Мандарин, Яблоко»
      expect(names).toEqual(['Мандарин', 'Арбуз', 'Яблоко']);
    });

    it('в каталоге только публичные комнаты: приватные и личные не попадают', async () => {
      const open = await publicRoom('Открытая');
      await repo.createGroup('private', 'Закрытая', ownerId);
      await pool.query("INSERT INTO rooms (type, direct_key) VALUES ('direct', '1:2')");
      const result = await repo.listPublic('', null, 20);
      expect(result.map((r) => r.id)).toEqual([open.id]);
      expect(result[0].type).toBe('public');
    });

    it('запись комнаты содержит все поля', async () => {
      const created = await publicRoom('Общая');
      const [room] = await repo.listPublic('', null, 20);
      expect(room).toMatchObject({
        id: created.id,
        type: 'public',
        name: 'Общая',
        createdBy: ownerId,
        directKey: null,
      });
      expect(room.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('структурное тестирование: поиск и курсор', () => {
    it('поиск по части названия без учёта регистра', async () => {
      await publicRoom('Арбуз');
      await publicRoom('Сарай');
      await publicRoom('Дом');
      const lower = (await repo.listPublic('ар', null, 20)).map((r) => r.name);
      const upper = (await repo.listPublic('АР', null, 20)).map((r) => r.name);
      expect(lower).toEqual(['Сарай', 'Арбуз']);
      expect(upper).toEqual(lower);
    });

    it('поиск и курсор действуют вместе', async () => {
      const first = await publicRoom('Чат один');
      await publicRoom('Другое');
      const third = await publicRoom('Чат два');
      expect((await repo.listPublic('Чат', null, 20)).map((r) => r.id)).toEqual([
        third.id,
        first.id,
      ]);
      expect((await repo.listPublic('Чат', third.id, 20)).map((r) => r.id)).toEqual([first.id]);
    });
  });

  describe('угадывание ошибок', () => {
    it('символы % и _ в запросе ищутся как обычные, а не как шаблон LIKE', async () => {
      await publicRoom('a_b');
      await publicRoom('axb');
      await publicRoom('100%');
      await publicRoom('1000');
      expect((await repo.listPublic('a_b', null, 20)).map((r) => r.name)).toEqual(['a_b']);
      expect((await repo.listPublic('_', null, 20)).map((r) => r.name)).toEqual(['a_b']);
      expect((await repo.listPublic('%', null, 20)).map((r) => r.name)).toEqual(['100%']);
    });

    it('страницы по курсору идут без повторов и пропусков, строго по убыванию id', async () => {
      for (let i = 1; i <= 5; i += 1) {
        await publicRoom(`Чат ${i}`);
      }
      const seen: number[] = [];
      const sizes: number[] = [];
      let cursor: number | null = null;
      for (let page = 0; page < 5; page += 1) {
        const rooms = await repo.listPublic('', cursor, 2);
        if (rooms.length === 0) break;
        sizes.push(rooms.length);
        seen.push(...rooms.map((r) => r.id));
        cursor = rooms[rooms.length - 1].id;
      }
      expect(sizes).toEqual([2, 2, 1]);
      expect(new Set(seen).size).toBe(5);
      expect(seen).toEqual([...seen].sort((a, b) => b - a));
    });
  });
});

describe('RoomRepository.listPublic: заглушка вместо БД, проверка запроса', () => {
  function createRepo() {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new RoomRepository({ query } as unknown as Pool);
    return { repo, query };
  }

  it('без поиска и курсора: один запрос, в параметрах только лимит', async () => {
    const { repo, query } = createRepo();
    await repo.listPublic('', null, 20);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toBe("SELECT * FROM rooms WHERE type = 'public' ORDER BY id DESC LIMIT $1");
    expect(params).toEqual([20]);
  });

  it('с поиском и курсором: параметры идут в порядке «шаблон, курсор, лимит»', async () => {
    const { repo, query } = createRepo();
    await repo.listPublic('чат', 50, 10);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('name ILIKE $1');
    expect(sql).toContain('id < $2');
    expect(sql).toContain('LIMIT $3');
    expect(params).toEqual(['%чат%', 50, 10]);
  });

  it('служебные символы запроса экранируются перед отправкой в БД', async () => {
    const { repo, query } = createRepo();
    await repo.listPublic('50%_off\\', null, 20);
    expect(query.mock.calls[0][1][0]).toBe('%50\\%\\_off\\\\%');
  });

  it('порядок ORDER BY id DESC есть при любом сочетании условий (на нём держится курсор)', async () => {
    const { repo, query } = createRepo();
    await repo.listPublic('', null, 5);
    await repo.listPublic('а', null, 5);
    await repo.listPublic('', 9, 5);
    await repo.listPublic('а', 9, 5);
    expect(query).toHaveBeenCalledTimes(4);
    for (const call of query.mock.calls) {
      expect(call[0]).toContain('ORDER BY id DESC');
      expect(call[0]).not.toContain('ORDER BY name');
    }
  });
});
