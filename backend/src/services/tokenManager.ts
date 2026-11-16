import { TokenRepository } from '../repositories/tokenRepository';

// Менеджер токенов
export class TokenManager {
  private repository: TokenRepository;

  constructor(repository: TokenRepository) {
    this.repository = repository;
  }

  save(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    return this.repository.save(userId, tokenHash, expiresAt);
  }

  findActive(tokenHash: string): Promise<{ id: number; userId: number } | null> {
    return this.repository.findActive(tokenHash);
  }

  revoke(id: number): Promise<void> {
    return this.repository.revoke(id);
  }

  revokeByHash(tokenHash: string): Promise<void> {
    return this.repository.revokeByHash(tokenHash);
  }
}
