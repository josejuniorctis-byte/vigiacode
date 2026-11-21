import type { FastifyInstance } from 'fastify';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  age: string;
  role: string;
  nickname: string;
  displayName: string;
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', async () => []);

  app.post('/api/users', async () => {
    return { ok: true };
  });
}
