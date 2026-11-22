// Copia as migrations SQL para dist/drizzle: o pacote npm publica só `dist`.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const source = path.join(packageRoot, 'drizzle');
const target = path.join(packageRoot, 'dist', 'drizzle');

if (!existsSync(path.join(source, 'meta', '_journal.json'))) {
  throw new Error(`Migrations não encontradas em ${source}. Rode "pnpm db:generate" antes.`);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Migrations copiadas para ${path.relative(packageRoot, target)}.`);
