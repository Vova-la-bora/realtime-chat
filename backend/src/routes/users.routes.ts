import { FastifyInstance } from 'fastify';
import { AppError } from '../errors';
import { ProfileFormatter } from '../mappers';
import { searchUsersSchema, updateProfileSchema } from '../schemas';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  const manager = app.container.getUserManager();
  const formatter = new ProfileFormatter();

  app.get('/api/users/me', async (request) => {
    const user = await manager.getById(request.userId);
    if (!user) {
      throw new AppError(404, 'user_not_found', 'Пользователь не найден');
    }
    return { user: formatter.format(user) };
  });

  app.patch('/api/users/me', async (request) => {
    const body = updateProfileSchema.parse(request.body);
    const user = await manager.updateProfile(request.userId, body);
    if (!user) {
      throw new AppError(404, 'user_not_found', 'Пользователь не найден');
    }
    return { user: formatter.format(user) };
  });

  // Поиск пользователей (email других людей не отдаётся)
  app.get('/api/users', async (request) => {
    const q = searchUsersSchema.parse(request.query);
    const users = await manager.search(q.query, request.userId, 20);
    return {
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        lastSeenAt: u.lastSeenAt,
      })),
    };
  });
}
