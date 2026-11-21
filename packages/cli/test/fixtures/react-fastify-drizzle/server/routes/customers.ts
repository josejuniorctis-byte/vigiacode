import type { FastifyInstance } from 'fastify';

export interface CustomerDto {
  id: number;
  displayName: string;
  email: string;
}

export async function customersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/customers', async () => []);
}
