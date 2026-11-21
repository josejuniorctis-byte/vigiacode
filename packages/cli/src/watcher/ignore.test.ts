import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config.js';
import { createIgnoreMatcher, IgnoreMatcher, isBinaryPath, readGitignore } from './ignore.js';
import { detectLayer } from './layers.js';

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeanchor-ignore-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('IgnoreMatcher', () => {
  it('sempre ignora node_modules, dist, .git e .codeanchor', () => {
    const matcher = new IgnoreMatcher([]);

    expect(matcher.ignores('node_modules/react/index.js')).toBe(true);
    expect(matcher.ignores('packages/web/dist/assets/app.js')).toBe(true);
    expect(matcher.ignores('.git/config')).toBe(true);
    expect(matcher.ignores('.codeanchor/codeanchor.db')).toBe(true);
    expect(matcher.ignores('coverage/lcov.info')).toBe(true);
    expect(matcher.ignores('src/index.ts')).toBe(false);
  });

  it('aplica padrões glob e permite re-incluir com negação', () => {
    const matcher = new IgnoreMatcher(['*.log', 'tmp/', '!tmp/keep.log', '**/generated/**']);

    expect(matcher.ignores('logs/app.log')).toBe(true);
    expect(matcher.ignores('tmp/arquivo.txt')).toBe(true);
    expect(matcher.ignores('tmp/keep.log')).toBe(false);
    expect(matcher.ignores('src/generated/types.ts')).toBe(true);
    expect(matcher.ignores('src/app.ts')).toBe(false);
  });

  it('combina config, defaults e .gitignore do projeto', () => {
    const projectRoot = makeDir();
    writeFileSync(path.join(projectRoot, '.gitignore'), '*.local\n/segredo.txt\n', 'utf8');

    const config = createDefaultConfig({ name: 'demo', rootPath: projectRoot });
    const matcher = createIgnoreMatcher(projectRoot, config.watch);

    expect(matcher.ignores('.env.local')).toBe(true);
    expect(matcher.ignores('segredo.txt')).toBe(true);
    expect(matcher.ignores('src/index.ts')).toBe(false);
    expect(readGitignore(projectRoot)).toContain('*.local');
  });

  it('identifica extensões binárias', () => {
    expect(isBinaryPath('public/logo.png')).toBe(true);
    expect(isBinaryPath('dist/app.wasm')).toBe(true);
    expect(isBinaryPath('src/index.ts')).toBe(false);
    expect(isBinaryPath('README.md')).toBe(false);
  });
});

describe('detectLayer', () => {
  it('detecta frontend, backend, banco e config', () => {
    expect(detectLayer('src/components/Button.tsx')).toBe('frontend');
    expect(detectLayer('src/pages/index.vue')).toBe('frontend');
    expect(detectLayer('src/routes/users.ts')).toBe('backend');
    expect(detectLayer('server/controllers/user.ts')).toBe('backend');
    expect(detectLayer('prisma/schema.prisma')).toBe('database');
    expect(detectLayer('migrations/0001_init.sql')).toBe('database');
    expect(detectLayer('package.json')).toBe('config');
    expect(detectLayer('vite.config.ts')).toBe('config');
    expect(detectLayer('README.md')).toBe('other');
  });
});
