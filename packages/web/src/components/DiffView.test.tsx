import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView, parseDiffLines } from './DiffView';

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 111..222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  '-const a = 1;',
  '+const a = 2;',
  ' const b = 3;',
].join('\n');

describe('DiffView', () => {
  it('renderiza linhas coloridas com números e aviso de truncagem', () => {
    render(<DiffView diff={DIFF} truncated />);

    expect(screen.getByText('const a = 2;')).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getAllByTestId('diff-add').length).toBe(1);
    expect(screen.getAllByTestId('diff-del').length).toBe(1);
    expect(screen.getByText(/Diff truncado pelo VigiaCode/)).toBeInTheDocument();
  });

  it('calcula números das colunas antiga/nova', () => {
    const lines = parseDiffLines(DIFF);
    const add = lines.find((line) => line.kind === 'add');
    const del = lines.find((line) => line.kind === 'del');

    expect(add).toMatchObject({ newNumber: 1, oldNumber: null });
    expect(del).toMatchObject({ oldNumber: 1, newNumber: null });
  });

  it('mostra aviso quando não há diff', () => {
    render(<DiffView diff="" />);
    expect(screen.getByText(/Sem diff para este evento/)).toBeInTheDocument();
  });
});
