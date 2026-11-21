export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

/**
 * Renderização própria de diff unificado, sem dependências de highlight.
 * Calcula os números das colunas antiga/nova.
 */
export function parseDiffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  const rawLines = diff.split(/\r?\n/);
  if (rawLines[rawLines.length - 1] === '') rawLines.pop();

  for (const raw of rawLines) {
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number(match[1]) - 1;
        newLine = Number(match[2]) - 1;
      }
      lines.push({ kind: 'hunk', text: raw, oldNumber: null, newNumber: null });
      continue;
    }

    if (
      raw.startsWith('diff --git ') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file mode') ||
      raw.startsWith('deleted file mode') ||
      raw.startsWith('similarity index') ||
      raw.startsWith('rename ') ||
      raw.startsWith('\\ No newline')
    ) {
      lines.push({ kind: 'meta', text: raw, oldNumber: null, newNumber: null });
      continue;
    }

    if (raw.startsWith('+')) {
      newLine += 1;
      lines.push({ kind: 'add', text: raw.slice(1), oldNumber: null, newNumber: newLine });
    } else if (raw.startsWith('-')) {
      oldLine += 1;
      lines.push({ kind: 'del', text: raw.slice(1), oldNumber: oldLine, newNumber: null });
    } else {
      oldLine += 1;
      newLine += 1;
      lines.push({
        kind: 'context',
        text: raw.startsWith(' ') ? raw.slice(1) : raw,
        oldNumber: oldLine,
        newNumber: newLine,
      });
    }
  }

  return lines;
}

export function DiffView({ diff, truncated }: { diff: string; truncated?: boolean }) {
  if (diff.trim().length === 0) {
    return (
      <p className="muted rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm">
        Sem diff para este evento (projeto sem Git ou arquivo binário).
      </p>
    );
  }

  const lines = parseDiffLines(diff);

  return (
    <div>
      {truncated ? (
        <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Diff truncado pelo CodeAnchor — parte das alterações não é exibida.
        </p>
      ) : null}
      <div
        className="scroll-thin overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] py-1"
        aria-label="Diff do arquivo"
      >
        {lines.map((line, index) => (
          <div
            key={`${index}-${line.kind}`}
            className={`diff-line ${
              line.kind === 'add'
                ? 'diff-line-add'
                : line.kind === 'del'
                  ? 'diff-line-del'
                  : line.kind === 'hunk'
                    ? 'diff-line-hunk'
                    : line.kind === 'meta'
                      ? 'diff-line-meta'
                      : ''
            }`}
            data-testid={`diff-${line.kind}`}
          >
            <span className="select-none px-2 text-right opacity-50">{line.oldNumber ?? ''}</span>
            <span className="select-none px-2 text-right opacity-50">{line.newNumber ?? ''}</span>
            <span className="min-w-0 whitespace-pre px-2">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
