import { existsSync } from 'node:fs';
import path from 'node:path';
import { Architect } from '../architect/index.js';
import { createBindingsScanner } from '../bindings/index.js';
import { configExists, readConfig, resolveConfigPaths } from '../config.js';
import {
  applyMigrations,
  findProjectByRootPath,
  openDatabase,
  type OpenedDatabase,
} from '../db/index.js';
import { startMcpServer } from '../mcp/server.js';
import { VERSION } from '../version.js';

export interface McpCommandOptions {
  cwd: string;
}

/**
 * `vigiacode mcp`: sobe o servidor MCP em stdio.
 *
 * stdout é reservado ao protocolo JSON-RPC; qualquer diagnóstico vai para
 * stderr.
 */
export async function runMcpCommand(options: McpCommandOptions): Promise<void> {
  const projectRoot = path.resolve(options.cwd);

  if (!configExists(projectRoot)) {
    stderr(`Projeto não inicializado em ${projectRoot}. Rode "vigiacode init" primeiro.`);
    process.exitCode = 1;
    return;
  }

  const config = readConfig(projectRoot);
  const paths = resolveConfigPaths(projectRoot, config.database.file);
  if (!existsSync(paths.databaseFile)) {
    stderr(`Banco local não encontrado em ${paths.databaseFile}. Rode "vigiacode init".`);
    process.exitCode = 1;
    return;
  }

  let opened: OpenedDatabase | null = null;
  try {
    opened = openDatabase(paths.databaseFile);
    applyMigrations(opened.db);
    const project = findProjectByRootPath(opened.db, projectRoot);
    if (!project) {
      stderr('Projeto não encontrado no banco local. Rode "vigiacode init" novamente.');
      opened.close();
      process.exitCode = 1;
      return;
    }

    const scanner = createBindingsScanner({ db: opened.db, project, config });
    const architect = new Architect({ db: opened.db, project, config });
    const server = await startMcpServer({
      opened,
      project,
      config,
      scanner,
      architect,
      version: VERSION,
    });
    stderr(`VigiaCode MCP conectado (projeto: ${project.name}).`);

    let closing = false;
    const shutdown = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      try {
        await server.close();
      } catch {
        // Encerramento best-effort: o cliente pode já ter desconectado.
      }
      opened?.close();
      process.exit(0);
    };

    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
    process.stdin.once('end', () => void shutdown());
    process.stdin.once('close', () => void shutdown());
  } catch (error) {
    opened?.close();
    stderr(
      `Não foi possível iniciar o servidor MCP: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

function stderr(message: string): void {
  process.stderr.write(`${message}\n`);
}
