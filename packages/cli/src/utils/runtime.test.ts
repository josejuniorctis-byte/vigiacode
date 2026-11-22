import { describe, expect, it } from 'vitest';
import { nodeVersionError } from './runtime.js';

describe('nodeVersionError', () => {
  it('aceita Node 22 e superiores', () => {
    expect(nodeVersionError('22.0.0')).toBeNull();
    expect(nodeVersionError('24.11.1')).toBeNull();
  });

  it('recusa Node anterior ao 22 com mensagem amigável', () => {
    const message = nodeVersionError('20.20.2');
    expect(message).toContain('Node.js 22 ou superior');
    expect(message).toContain('20.20.2');
    expect(message).toContain('https://nodejs.org');
  });

  it('recusa qualquer versão 21.x', () => {
    expect(nodeVersionError('21.7.3')).not.toBeNull();
  });
});
