import type { ExtractContext, FileExtract, LayerExtractor } from '../types.js';
import { emptyFileExtract } from '../types.js';
import { backendExtractor } from './backend.js';
import { databaseExtractor } from './database.js';
import { frontendExtractor } from './frontend.js';

export const EXTRACTORS: readonly LayerExtractor[] = [
  frontendExtractor,
  backendExtractor,
  databaseExtractor,
];

/**
 * Roda os extractors aplicáveis a um arquivo.
 * Cada camada devolve seu próprio mapa normalizado; erros ficam isolados por
 * camada para que um arquivo estranho nunca derrube o scan inteiro.
 */
export function extractFile(context: ExtractContext): FileExtract[] {
  const results: FileExtract[] = [];

  for (const extractor of EXTRACTORS) {
    if (!extractor.supports(context.file, context.content)) continue;
    try {
      results.push(extractor.extract(context));
    } catch (error) {
      const failed = emptyFileExtract(context.file, extractor.layer, extractor.name);
      failed.errors.push(error instanceof Error ? error.message : String(error));
      results.push(failed);
    }
  }

  return results;
}

export { backendExtractor, databaseExtractor, frontendExtractor };
export { classifyFile, isSupportedBindingFile } from '../classify.js';
