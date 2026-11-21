import { describe, expect, it } from 'vitest';
import {
  isAuxiliaryTypeName,
  nameSimilarity,
  normalizeEntityName,
  normalizeFieldName,
  normalizeType,
  semanticKey,
  singularize,
  splitWords,
  tokenSimilarity,
  typesCompatible,
} from './names.js';

describe('normalizador de nomes', () => {
  it('quebra camelCase, PascalCase, snake_case e kebab-case', () => {
    expect(splitWords('customerName')).toEqual(['customer', 'name']);
    expect(splitWords('CustomerName')).toEqual(['customer', 'name']);
    expect(splitWords('customer_name')).toEqual(['customer', 'name']);
    expect(splitWords('customer-name')).toEqual(['customer', 'name']);
    expect(splitWords('UserDTO')).toEqual(['user', 'dto']);
  });

  it('singulariza plurais simples em inglês e português', () => {
    expect(singularize('users')).toBe('user');
    expect(singularize('clientes')).toBe('cliente');
    expect(singularize('categories')).toBe('category');
    expect(singularize('addresses')).toBe('address');
    expect(singularize('status')).toBe('status');
  });

  it('normaliza entidades removendo sufixos e plurais', () => {
    expect(normalizeEntityName('UsersPage')).toBe('user');
    expect(normalizeEntityName('UserDto')).toBe('user');
    expect(normalizeEntityName('create_user_request')).toBe('create_user');
    expect(normalizeEntityName('customers')).toBe('customer');
    expect(normalizeEntityName('ProductController')).toBe('product');
  });

  it('normaliza campos e remove sufixo Id', () => {
    expect(normalizeFieldName('customerName')).toBe('customer_name');
    expect(normalizeFieldName('customer_name')).toBe('customer_name');
    expect(normalizeFieldName('user_id')).toBe('user');
    expect(normalizeFieldName('userId')).toBe('user');
    expect(normalizeFieldName('id')).toBe('id');
  });

  it('reconhece tipos auxiliares que não são modelos', () => {
    expect(isAuxiliaryTypeName('UserFormProps')).toBe(true);
    expect(isAuxiliaryTypeName('User')).toBe(false);
  });

  it('casa sinônimos PT/EN na chave semântica', () => {
    expect(semanticKey('cliente_nome')).toBe(semanticKey('customerName'));
    expect(semanticKey('nome_completo')).toBe(semanticKey('fullName'));
    expect(semanticKey('criado_em')).toBe(semanticKey('createdAt'));
    expect(tokenSimilarity('customerName', 'displayName')).toBeGreaterThan(0);
  });

  it('mede similaridade para a regra R8', () => {
    expect(nameSimilarity('displayName', 'name')).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity('phone', 'email')).toBeLessThan(0.5);
  });

  it('normaliza tipos das stacks e compara compatibilidade', () => {
    expect(normalizeType('varchar(120)')).toBe('string');
    expect(normalizeType('String')).toBe('string');
    expect(normalizeType('integer')).toBe('number');
    expect(normalizeType('double')).toBe('number');
    expect(normalizeType('BigDecimal')).toBe('decimal');
    expect(normalizeType('DECIMAL(10,2)')).toBe('decimal');
    expect(normalizeType('LocalDateTime')).toBe('date');
    expect(normalizeType('boolean')).toBe('boolean');

    expect(typesCompatible('string', 'string')).toBe(true);
    expect(typesCompatible('string', 'number')).toBe(false);
    expect(typesCompatible('number', 'decimal')).toBe(false);
    expect(typesCompatible('unknown', 'decimal')).toBe(true);
  });
});
