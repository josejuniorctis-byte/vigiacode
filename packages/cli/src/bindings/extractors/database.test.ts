import { describe, expect, it } from 'vitest';
import { databaseExtractor } from './database.js';

describe('database extractor', () => {
  it('extrai Drizzle (colunas encadeadas e tipos)', () => {
    const output = databaseExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'db/schema.ts',
      content: `
        import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

        export const users = sqliteTable('users', {
          id: integer('id').primaryKey(),
          name: text('name').notNull(),
          fullName: text('full_name'),
          price: real('price'),
        });
      `,
    });

    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user).toBeDefined();
    expect(user?.fields.map((field) => `${field.name}:${field.type}`)).toEqual([
      'id:number',
      'name:string',
      'full_name:string',
      'price:number',
    ]);
    expect(user?.fields.find((field) => field.name === 'id')?.rawName).toBe('id');
    expect(user?.fields.find((field) => field.name === 'full_name')?.rawName).toBe('full_name');
  });

  it('extrai Prisma model e @@map', () => {
    const output = databaseExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'prisma/schema.prisma',
      content: `
        model User {
          id Int @id @default(autoincrement())
          name String
          email String
          legacyCode String?
          posts Post[]

          @@map("users")
        }
      `,
    });

    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user?.rawName).toBe('users');
    expect(user?.fields.map((field) => field.name)).toEqual(['id', 'name', 'email', 'legacy_code']);
    expect(user?.fields.find((field) => field.name === 'legacy_code')?.optional).toBe(true);
  });

  it('extrai JPA: @Entity/@Table/@Column', () => {
    const output = databaseExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/main/java/Product.java',
      content: `
        @Entity
        @Table(name = "products")
        public class Product {
          @Id
          private Long id;

          @Column(name = "full_name")
          private String fullName;

          @Column(name = "price")
          private java.math.BigDecimal price;
        }
      `,
    });

    const product = output.entities.find((entity) => entity.name === 'product');
    expect(product?.rawName).toBe('products');
    expect(product?.fields.map((field) => `${field.name}:${field.type}`)).toEqual([
      'id:number',
      'full_name:string',
      'price:decimal',
    ]);
  });

  it('extrai SQL CREATE TABLE, ALTER ADD e DROP COLUMN', () => {
    const output = databaseExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/main/resources/db/migration/V1__init.sql',
      content: `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          price DECIMAL(10, 2) NOT NULL,
          obsolete TEXT,
          CONSTRAINT users_pk PRIMARY KEY (id)
        );
        ALTER TABLE users ADD COLUMN phone TEXT;
        ALTER TABLE users DROP COLUMN obsolete;
      `,
    });

    expect(output.migrations).toHaveLength(1);
    const migration = output.migrations[0];
    expect(migration?.entity).toBe('user');
    expect(migration?.fields.map((field) => field.name)).toEqual(['id', 'name', 'price', 'phone']);
    expect(migration?.fields.find((field) => field.name === 'price')?.rawType).toBe(
      'DECIMAL(10, 2)',
    );
  });

  it('extrai TypeORM @Entity/@Column', () => {
    const output = databaseExtractor.extract({
      projectRoot: '/tmp/project',
      file: 'src/entities/User.ts',
      content: `
        import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

        @Entity('users')
        export class User {
          @PrimaryGeneratedColumn()
          id: number;

          @Column({ name: 'full_name', type: 'varchar' })
          fullName: string;
        }
      `,
    });

    const user = output.entities.find((entity) => entity.name === 'user');
    expect(user?.rawName).toBe('users');
    expect(user?.fields.map((field) => `${field.name}:${field.rawType}`)).toEqual([
      'id:number',
      'full_name:string',
    ]);
  });
});
