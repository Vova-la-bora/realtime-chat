import { UserRecord } from '../models';
import { UserRepository } from '../repositories/userRepository';

// Управление пользователями
export class UserManager {
  private repository: UserRepository;

  constructor(repository: UserRepository) {
    this.repository = repository;
  }

  getRepository(): UserRepository {
    return this.repository;
  }

  getById(id: number): Promise<UserRecord | null> {
    return this.repository.findById(id);
  }

  updateProfile(
    id: number,
    fields: { displayName?: string; avatarUrl?: string | null },
  ): Promise<UserRecord | null> {
    return this.repository.updateProfile(id, fields);
  }

  search(query: string, excludeId: number, limit: number): Promise<UserRecord[]> {
    return this.repository.search(query, excludeId, limit);
  }
}
