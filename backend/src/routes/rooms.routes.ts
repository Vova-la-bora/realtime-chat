import { FastifyInstance } from 'fastify';
import { AppError } from '../errors';
import {
  createRoomSchema,
  historyQuerySchema,
  idParamSchema,
  publicRoomsQuerySchema,
  searchMessagesQuerySchema,
  userIdBodySchema,
} from '../schemas';

function buildRoomJson(id: number, type: string, name: string | null, createdBy: number | null) {
  return { id, type, name, createdBy };
}

export async function roomsRoutes(app: FastifyInstance): Promise<void> {
  const facade = app.container.getRoomFacade();

  app.get('/api/rooms', async (request) => {
    return { items: await facade.listForUser(request.userId) };
  });

  app.get('/api/rooms/public', async (request) => {
    const q = publicRoomsQuerySchema.parse(request.query);
    const page = await facade.listPublic(q.query ?? '', q.cursor ?? null);
    return {
      items: page.rooms.map((r) => buildRoomJson(r.id, r.type, r.name, r.createdBy)),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  });

  app.post('/api/rooms', async (request, reply) => {
    const body = createRoomSchema.parse(request.body);
    const room = await facade.createGroup(request.userId, body.name, body.type);
    return reply
      .status(201)
      .send({ room: buildRoomJson(room.id, room.type, room.name, room.createdBy) });
  });

  app.post('/api/rooms/direct', async (request) => {
    const body = userIdBodySchema.parse(request.body);
    const room = await facade.openDirect(request.userId, body.userId);
    return { room: buildRoomJson(room.id, room.type, room.name, room.createdBy) };
  });

  app.post('/api/rooms/:id/join', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const room = await facade.join(id, request.userId);
    return { room: buildRoomJson(room.id, room.type, room.name, room.createdBy) };
  });

  app.post('/api/rooms/:id/leave', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await facade.leave(id, request.userId);
    return reply.status(204).send();
  });

  app.post('/api/rooms/:id/invite', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = userIdBodySchema.parse(request.body);
    await facade.invite(id, request.userId, body.userId);
    return reply.status(204).send();
  });

  app.get('/api/rooms/:id/messages', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const q = historyQuerySchema.parse(request.query);
    return app.container.getMessageService().getHistory(id, request.userId, q.before_id, q.limit);
  });

  // Полнотекстовый поиск по сообщениям комнаты: ?query=текст&before_id=&limit=20
  app.get('/api/rooms/:id/search', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const q = searchMessagesQuerySchema.parse(request.query);
    return app.container
      .getMessageService()
      .search(id, request.userId, q.query, q.before_id, q.limit);
  });

  app.get('/api/rooms/:id/members', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const room = await request.server.container
      .getRoomFacade()
      .getService()
      .getRepository()
      .findById(id);
    if (!room) {
      throw new AppError(404, 'room_not_found', 'Комната не найдена');
    }
    return { items: await facade.getMembers(id, request.userId) };
  });
}
