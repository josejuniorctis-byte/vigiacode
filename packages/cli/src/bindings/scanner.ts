import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LLMProvider } from '../ai/index.js';
import type { VigiaCodeConfig } from '../config.js';
import {
  clearBindingFileCache,
  deleteBindingFileCache,
  finishBindingScan,
  insertBindingScan,
  listBindingFileCache,
  listBindingScans,
  putBindingFileCache,
  resolveBindingsNotSeen,
  setBindingsRescanRequired,
  summarizeBindings,
  syncAcceptedBindingFlags,
  upsertBinding,
  type BindingSummary,
} from '../db/bindings-repository.js';
import type { VigiaCodeDatabase } from '../db/client.js';
import { bindingIdentityKey } from '../db/bindings-repository.js';
import { findProjectById } from '../db/repository.js';
import type { Binding, Project } from '../db/schema.js';
import { IgnoreMatcher, createIgnoreMatcher } from '../watcher/ignore.js';
import { isSupportedBindingFile } from './classify.js';
import { extractFile } from './extractors/index.js';
import { isGeneratedBindingFile } from './extractors/common.js';
import { buildMatchContext } from './matcher.js';
import { buildMatrix } from './matrix.js';
import { combineExtracts } from './project-map.js';
import { evaluateRulesDetailed } from './rules.js';
import {
  formatRef,
  type BindingMatrix,
  type BindingsScanResult,
  type BindingsStreamMessage,
  type FileExtract,
  type Finding,
  type ScanBindingView,
} from './types.js';

export interface BindingsEventPublisher {
  publish(message: BindingsStreamMessage): void;
}

export interface BindingsScannerOptions {
  db: VigiaCodeDatabase;
  project: Project;
  config: VigiaCodeConfig;
  hub?: BindingsEventPublisher | null;
  provider?: LLMProvider | null;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
  };
  maxFileSizeKb?: number;
}

export interface ScanOptions {
  trigger?: 'manual' | 'watch' | 'start';
  /** Caminhos relativos POSIX; quando presentes, faz scan incremental. */
  changedFiles?: string[] | undefined;
  batchId?: string | null;
  /** Progresso em arquivos (usado pelo terminal em repositórios grandes). */
  onProgress?: ((progress: ScanProgress) => void) | undefined;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  file: string;
  incremental: boolean;
}

/**
 * Versão dos extractors. Bump ao mudar a extração para invalidar o cache por
 * hash: arquivos inalterados precisam ser reprocessados com a lógica nova.
 */
export const BINDINGS_EXTRACTOR_VERSION = '4';

/**
 * Orquestra o detector:
 * caminhada de arquivos → hash cache → extractors → matcher → regras →
 * upsert/resolução no banco → SSE.
 *
 * Scans são serializados para evitar corrida entre `start`, watcher e API.
 */
export class BindingsScanner {
  private readonly db: VigiaCodeDatabase;
  private readonly project: Project;
  private readonly config: VigiaCodeConfig;
  private readonly hub: BindingsEventPublisher | null;
  private readonly provider: LLMProvider | null;
  private readonly maxFileSizeKb: number;
  private readonly logger: BindingsScannerOptions['logger'];
  private readonly bindingsIgnore: IgnoreMatcher;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: BindingsScannerOptions) {
    this.db = options.db;
    this.project = options.project;
    this.config = options.config;
    this.hub = options.hub ?? null;
    this.provider = options.provider ?? null;
    this.maxFileSizeKb = options.maxFileSizeKb ?? options.config.watch.maxFileSizeKb;
    this.logger = options.logger;
    this.bindingsIgnore = new IgnoreMatcher(options.config.bindings.ignore);
  }

  summary(): BindingSummary {
    return summarizeBindings(this.db, this.project.id);
  }

  matrix(): BindingMatrix | null {
    const scans = listBindingScans(this.db, this.project.id, 1);
    const latest = scans[0];
    if (!latest?.matrixJson) return null;
    try {
      return JSON.parse(latest.matrixJson) as BindingMatrix;
    } catch {
      return null;
    }
  }

  /** Aguarda scans em andamento (usado no shutdown). */
  async drain(timeoutMs = 5_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.chain,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  scan(options: ScanOptions = {}): Promise<BindingsScanResult | null> {
    const run = this.chain.then(() => this.runScan(options));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runScan(options: ScanOptions): Promise<BindingsScanResult | null> {
    const trigger = options.trigger ?? 'manual';
    const projectRoot = this.project.rootPath;

    // A migration de correção marca o projeto para rescan completo. Nesse caso
    // ignoramos a lista incremental e o cache: o banco será repopulado do zero.
    const forceFull = findProjectById(this.db, this.project.id)?.bindingsRescanRequired === true;
    if (forceFull) clearBindingFileCache(this.db, this.project.id);

    const changed = forceFull
      ? undefined
      : options.changedFiles?.filter(
          (file) =>
            isSupportedBindingFile(file) &&
            !isGeneratedBindingFile(file) &&
            !this.bindingsIgnore.ignores(file),
        );
    if (!forceFull && options.changedFiles && (changed === undefined || changed.length === 0)) {
      return null;
    }

    const scan = insertBindingScan(this.db, {
      projectId: this.project.id,
      trigger,
      batchId: options.batchId ?? null,
    });

    try {
      const walked = changed === undefined ? walkProjectFiles(projectRoot, this.config) : [];
      const toProcess = changed ?? walked;
      let filesScanned = 0;
      const progressEvery = Math.max(1, Math.floor(toProcess.length / 20));

      const cache = new Map(
        listBindingFileCache(this.db, this.project.id).map((item) => [item.filePath, item]),
      );

      if (changed === undefined) {
        const knownFiles = new Set(walked);
        for (const cached of cache.values()) {
          if (!knownFiles.has(cached.filePath)) {
            deleteBindingFileCache(this.db, this.project.id, cached.filePath);
            cache.delete(cached.filePath);
          }
        }
      }

      for (const [index, file] of toProcess.entries()) {
        if (index > 0 && index % progressEvery === 0) {
          options.onProgress?.({
            scanned: index,
            total: toProcess.length,
            file,
            incremental: changed !== undefined,
          });
        }
        if (this.extractAndCache(projectRoot, file, options.changedFiles !== undefined, cache)) {
          filesScanned += 1;
        }
      }
      options.onProgress?.({
        scanned: toProcess.length,
        total: toProcess.length,
        file: toProcess.at(-1) ?? '',
        incremental: changed !== undefined,
      });

      const extracts = this.loadCachedExtracts();
      const map = combineExtracts(extracts.effects);
      const match = await buildMatchContext(map, {
        provider: this.provider,
        semanticMatching: this.config.bindings.semanticMatching,
      });
      const evaluation = evaluateRulesDetailed(map, match, this.config.bindings);
      const findings = evaluation.findings;

      const created: ScanBindingView[] = [];
      const seen = new Set<string>();
      for (const finding of findings) {
        const result = upsertBinding(this.db, {
          projectId: this.project.id,
          ruleId: finding.ruleId,
          layer: finding.layer,
          entity: finding.entity,
          field: finding.field,
          status: finding.status,
          severity: finding.severity,
          message: finding.message,
          frontRef: formatRef(finding.frontRef),
          backRef: formatRef(finding.backRef),
          dbRef: formatRef(finding.dbRef),
          suggestion: finding.suggestion ?? null,
        });
        seen.add(bindingIdentityKey(result.binding));
        if (result.created || result.reopened) created.push(toView(result.binding));
      }

      const resolvedRows = resolveBindingsNotSeen(this.db, this.project.id, seen);
      // A coluna accepted é derivada do config.json: ressincroniza a cada scan.
      syncAcceptedBindingFlags(
        this.db,
        this.project.id,
        this.config.bindings.acceptedFalsePositives,
      );
      const matrix = buildMatrix(map, findings, scan.id);
      const coverage = {
        profile: evaluation.profile,
        typedHttpClient: evaluation.typedHttpClient,
        rules: evaluation.coverage,
      };
      const finished = finishBindingScan(this.db, scan.id, {
        filesScanned,
        red: findings.filter((finding) => finding.status === 'red').length,
        yellow: findings.filter((finding) => finding.status === 'yellow').length,
        green: findings.filter((finding) => finding.status === 'green').length,
        created: created.length,
        resolved: resolvedRows.length,
        matrixJson: JSON.stringify(matrix),
        coverageJson: JSON.stringify(coverage),
      });
      if (forceFull) setBindingsRescanRequired(this.db, this.project.id, false);

      const finishedScan = finished ?? scan;
      const summary = summarizeBindings(this.db, this.project.id, finishedScan);
      const result: BindingsScanResult = {
        scan: finishedScan,
        summary,
        created,
        resolved: resolvedRows.map(toView),
        matrix,
        filesScanned,
        trigger,
        batchId: options.batchId ?? null,
      };

      this.hub?.publish({
        type: 'bindings',
        scanId: finishedScan.id,
        trigger,
        batchId: options.batchId ?? null,
        counts: { red: summary.red, yellow: summary.yellow, green: summary.green },
        created,
        resolved: result.resolved,
        summary,
      });

      return result;
    } catch (error) {
      finishBindingScan(this.db, scan.id, {
        filesScanned: 0,
        red: 0,
        yellow: 0,
        green: 0,
        created: 0,
        resolved: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger?.warn(
        `Detector de amarrações: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private extractAndCache(
    projectRoot: string,
    file: string,
    incremental: boolean,
    cache: Map<string, { filePath: string; hash: string; extractor: string }>,
  ): boolean {
    const absolute = path.resolve(projectRoot, file);

    if (!existsSync(absolute)) {
      deleteBindingFileCache(this.db, this.project.id, file);
      cache.delete(file);
      return false;
    }

    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      deleteBindingFileCache(this.db, this.project.id, file);
      cache.delete(file);
      return false;
    }
    if (!stats.isFile()) return false;
    if (stats.size > Math.max(1, this.maxFileSizeKb) * 1024) return false;

    let content: string;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      if (incremental) {
        deleteBindingFileCache(this.db, this.project.id, file);
        cache.delete(file);
      }
      return false;
    }

    const hash = createHash('sha1').update(content).digest('hex');
    const cached = cache.get(file);
    if (
      cached &&
      cached.hash === hash &&
      cached.extractor.startsWith(`${BINDINGS_EXTRACTOR_VERSION}:`)
    ) {
      return true;
    }

    const extracts = extractFile({ projectRoot, file, content });
    if (extracts.length === 0) {
      deleteBindingFileCache(this.db, this.project.id, file);
      cache.delete(file);
      return false;
    }

    const stored = putBindingFileCache(this.db, {
      projectId: this.project.id,
      filePath: file,
      hash,
      layer: extracts[0]?.layer ?? 'frontend',
      extractor: `${BINDINGS_EXTRACTOR_VERSION}:${extracts.map((extract) => extract.extractor).join(',')}`,
      data: JSON.stringify(extracts),
    });
    cache.set(file, stored);
    return true;
  }

  private loadCachedExtracts(): { effects: FileExtract[] } {
    const effects: FileExtract[] = [];
    for (const cached of listBindingFileCache(this.db, this.project.id)) {
      try {
        const parsed = JSON.parse(cached.data) as FileExtract[];
        if (Array.isArray(parsed)) effects.push(...parsed);
      } catch {
        // Cache corrompido: ignora; o próximo scan completo regrava.
      }
    }
    return { effects };
  }
}

export function createBindingsScanner(options: BindingsScannerOptions): BindingsScanner {
  return new BindingsScanner(options);
}

/** Percorre o projeto respeitando watch.ignore, .gitignore e bindings.ignore. */
export function walkProjectFiles(projectRoot: string, config: VigiaCodeConfig): string[] {
  const watchMatcher = createIgnoreMatcher(projectRoot, config.watch);
  const bindingsMatcher = new IgnoreMatcher(config.bindings.ignore);
  const files: string[] = [];

  const visit = (directory: string, relativeDirectory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative =
        relativeDirectory.length > 0 ? `${relativeDirectory}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (watchMatcher.ignores(relative, true) || bindingsMatcher.ignores(relative, true)) {
          continue;
        }
        visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (watchMatcher.ignores(relative) || bindingsMatcher.ignores(relative)) continue;
      if (!isSupportedBindingFile(relative) || isGeneratedBindingFile(relative)) continue;
      files.push(relative);
    }
  };

  visit(projectRoot, '');
  return files;
}

export function toView(binding: Binding): ScanBindingView {
  return {
    id: binding.id,
    projectId: binding.projectId,
    ruleId: binding.ruleId,
    layer: binding.layer,
    entity: binding.entity,
    field: binding.field,
    status: binding.status,
    severity: binding.severity,
    message: binding.message,
    frontRef: binding.frontRef,
    backRef: binding.backRef,
    dbRef: binding.dbRef,
    suggestion: binding.suggestion,
    firstSeenAt: binding.firstSeenAt,
    lastSeenAt: binding.lastSeenAt,
    resolvedAt: binding.resolvedAt,
    accepted: binding.accepted,
  };
}

/** Exposto para testes e para a API. */
export type { Finding };
