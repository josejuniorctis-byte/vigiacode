import { describe, expect, it } from 'vitest';
import { backendExtractor } from './backend.js';

describe('backend extractor', () => {
  it('extrai rotas Fastify/Express, DTO TS e zod', () => {
    const output = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'server/routes/users.ts',
      content: `
        import type { FastifyInstance } from 'fastify';
        import { z } from 'zod';

        export interface UserDto {
          id: number;
          name: string;
          nickname?: string;
          age: string;
        }

        const CreateUserSchema = z.object({
          name: z.string(),
          email: z.string().email(),
          phone: z.string().optional(),
        });

        export async function usersRoutes(app: FastifyInstance) {
          app.get('/api/users', async () => []);
          app.post('/api/users', async () => ({}));
          fastify.route({ method: 'DELETE', url: '/api/users/:id', handler: async () => ({}) });
        }
      `,
    });

    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/users', entity: 'user' }),
        expect.objectContaining({ method: 'POST', path: '/api/users', entity: 'user' }),
        expect.objectContaining({ method: 'DELETE', path: '/api/users/:param' }),
      ]),
    );

    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user).toBeDefined();
    expect(user?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'nickname']),
    );

    const createUser = output.entities.find((entity) => entity.name === 'create_user');
    expect(createUser).toBeDefined();
    expect(createUser?.fields.map((field) => `${field.name}:${field.type}`)).toEqual(
      expect.arrayContaining(['name:string', 'email:string', 'phone:string']),
    );
    const phone = createUser?.fields.find((field) => field.name === 'phone');
    expect(phone?.optional).toBe(true);
  });

  it('extrai rotas Nest com @Controller/@Get', () => {
    const output = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/users/users.controller.ts',
      content: `
        import { Controller, Get, Post } from '@nestjs/common';

        @Controller('/api/users')
        export class UsersController {
          @Get(':id')
          findOne() { return {}; }

          @Post()
          create() { return {}; }
        }
      `,
    });

    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/users/:param', source: 'nest' }),
        expect.objectContaining({ method: 'POST', path: '/api/users', source: 'nest' }),
      ]),
    );
  });

  it('extrai Next API routes por caminho e exports GET/POST', () => {
    const output = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'app/api/users/[id]/route.ts',
      content: `
        import { NextResponse } from 'next/server';
        export async function GET() { return NextResponse.json({}); }
        export async function PUT() { return NextResponse.json({}); }
        interface UserDto { id: number; name: string; }
      `,
    });

    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/users/:param', source: 'next' }),
        expect.objectContaining({ method: 'PUT', path: '/api/users/:param', source: 'next' }),
      ]),
    );
    expect(output.entities.find((entity) => entity.name === 'user')?.fields.length).toBe(2);
  });

  it('extrai Spring: @RequestMapping + @GetMapping/@PostMapping e record DTO', () => {
    const controller = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/main/java/ProductController.java',
      content: `
        @RestController
        @RequestMapping("/api/products")
        public class ProductController {
          @GetMapping
          public List<ProductDto> list() { return List.of(); }

          @GetMapping("/{id}")
          public ProductDto get(@PathVariable Long id) { return null; }

          @PostMapping
          public ProductDto create() { return null; }
        }
      `,
    });

    expect(controller.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/products' }),
        expect.objectContaining({ method: 'GET', path: '/api/products/:param' }),
        expect.objectContaining({ method: 'POST', path: '/api/products' }),
      ]),
    );

    const dto = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/main/java/ProductDto.java',
      content: `
        public record ProductDto(Long id, String name, double price, Integer stock) {}
      `,
    });
    const product = dto.entities.find((entity) => entity.name === 'product');
    expect(product?.fields.map((field) => `${field.name}:${field.type}`)).toEqual([
      'id:number',
      'name:string',
      'price:number',
      'stock:number',
    ]);
  });

  it('extrai FastAPI: APIRouter e modelo pydantic', () => {
    const output = backendExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'app/api/users.py',
      content: `
        from fastapi import APIRouter
        from pydantic import BaseModel
        from typing import Optional

        router = APIRouter(prefix="/api")

        class UserDto(BaseModel):
            id: int
            name: str
            phone: Optional[str] = None

        @router.get("/users")
        def list_users():
            return []

        @router.post("/users")
        def create_user(dto: UserDto):
            return dto
      `,
    });

    expect(output.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/users', source: 'fastapi' }),
        expect.objectContaining({ method: 'POST', path: '/api/users', source: 'fastapi' }),
      ]),
    );
    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user?.fields.map((field) => field.name)).toEqual(['id', 'name', 'phone']);
    expect(user?.fields.find((field) => field.name === 'phone')?.optional).toBe(true);
  });
});
