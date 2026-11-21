import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  age: integer('age').notNull(),
  role: text('role').notNull(),
  displayName: text('display_name'),
  legacyCode: text('legacy_code'),
  price: real('price'),
});

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
});
