import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, createRoom, createTestApp, registerUser, resetDb } from './helpers';

describe('GET /api/rooms/:id/members', () => {
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

  it('returns members through the room facade', async () => {
    const owner = await registerUser(app, 'room_owner');
    const roomId = await createRoom(app, owner, 'Members room');

    const response = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: authHeader(owner),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.id, role: 'owner' }),
      ]),
    );
  });

  it('returns room_not_found for a missing room', async () => {
    const user = await registerUser(app, 'room_reader');

    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms/999999/members',
      headers: authHeader(user),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('room_not_found');
  });

  it('rejects a user who is not a member of the room', async () => {
    const owner = await registerUser(app, 'room_owner');
    const outsider = await registerUser(app, 'room_outsider');
    const roomId = await createRoom(app, owner, 'Private members room', 'private');

    const response = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: authHeader(outsider),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('not_a_member');
  });
});
