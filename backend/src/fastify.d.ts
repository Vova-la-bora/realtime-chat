import { ServiceContainer } from './container';

declare module 'fastify' {
  interface FastifyInstance {
    container: ServiceContainer;
  }
  interface FastifyRequest {
    userId: number;
  }
}
