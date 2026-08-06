import { describe, it, expect } from 'vitest';
import { findVarDefinition, parseKeys, parseAssignmentsLoc, getXorKey } from '../src/parser.js';

describe('findVarDefinition', () => {
  it('resolves a variable to its (recursively resolved) initializer', () => {
    const code = ['var foo = "bar";', 'var baz = foo + "!";'].join('\n');
    const value = findVarDefinition('baz', 3, code);
    expect(value).toContain('"bar"');
  });

  it('returns null for definitions beyond the start line', () => {
    const code = ['var foo = "bar";', 'const x = foo;'].join('\n');
    expect(findVarDefinition('x', 1, code)).toBeNull();
  });
});

describe('parseAssignmentsLoc + parseKeys', () => {
  const code = [
    'var mem = {};',
    'var var_key = "abc";',
    'var var_val = 5;',
    'var payload = {};',
    'var var_out = XOR_STR(var_val, var_seed);',
    'var var_seed = "secret";',
    'JSON.stringify(payload);',
    'payload[var_key] = var_val;',
  ].join('\n');

  it('collects object assignments backed by literal values', () => {
    const assignments = parseAssignmentsLoc(code);
    expect(assignments.abc).toBe('5');
  });

  it('extracts the xor key from the final XOR_STR call', () => {
    expect(getXorKey(code)).toBe('secret');
  });

  it('parseKeys returns the xor key and typed key map', () => {
    const [xorKey, keys] = parseKeys(code);
    expect(xorKey).toBe('secret');
    expect(keys.abc).toBe('5');
  });
});