const MINIMUM_NODE_MAJOR = 22;

export function nodeVersionError(version: string = process.versions.node): string | null {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major >= MINIMUM_NODE_MAJOR) return null;
  return [
    `VigiaCode requer Node.js ${MINIMUM_NODE_MAJOR} ou superior (versão atual: ${version}).`,
    'Atualize o Node em https://nodejs.org e rode o comando novamente.',
  ].join('\n');
}
