import { readFileSync } from 'node:fs';

interface PackageJson {
  version?: string;
}

function readPackageVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as PackageJson;
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Versão do pacote lida de package.json em tempo de execução (src e dist). */
export const VERSION: string = readPackageVersion();
