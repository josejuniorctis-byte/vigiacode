import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // better-sqlite3 é um módulo nativo: usar processos (não threads) evita
    // problemas de carregamento do binding em tempo de teste.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
