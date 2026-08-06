import { describe, it, expect } from 'vitest';
import { encode, generateToken, mod, runCheck, solvePow } from '../src/challenges.js';

describe('encode', () => {
  it('returns base64 of the JSON-serialized config', () => {
    const cfg = [1, 'two', null, 4];
    expect(encode(cfg)).toBe(Buffer.from('[1,"two",null,4]', 'utf8').toString('base64'));
  });
});

describe('generateToken', () => {
  it('prepends the anonymous marker and forces nonce field to 1', () => {
    const cfg: Array<string | number | null> = ['a', 'b', 'c', 99];
    const token = generateToken(cfg);
    expect(token.startsWith('gAAAAAC')).toBe(true);
    expect(cfg[3]).toBe(1);
    expect(token.slice(7)).toBe(encode(cfg));
  });

  it('returns an error token when the config cannot be encoded', () => {
    const circular: Array<string | number | null> = [];
    circular.push(circular);
    const token = generateToken(circular);
    expect(token.startsWith('error_')).toBe(true);
  });
});

describe('mod', () => {
  it('is deterministic and outputs 8 hex chars', () => {
    const a = mod('seed-abc');
    expect(a).toBe(mod('seed-abc'));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for different inputs', () => {
    expect(mod('one')).not.toBe(mod('two'));
  });
});

describe('solvePow', () => {
  it('produces a proof for an always-passable difficulty', () => {
    const proof = solvePow('seed', 'f', [1, 2, 3, 0, 'x'], 100);
    expect(proof).not.toBeNull();
    expect(proof!.startsWith('gAAAAAB')).toBe(true);
    expect(proof!.endsWith('~S')).toBe(true);
  });

  it('returns null when no iterations are allowed', () => {
    expect(solvePow('seed', 'f', [1, 2, 3, 0, 'x'], 0)).toBeNull();
  });

  it('runCheck only succeeds below the difficulty threshold', () => {
    const out = runCheck(0, 'seed', 'f', 0, [1, 2, 3, 0, 'x'] as Array<string | number | null>);
    expect(out).toMatch(/~S$/);
  });
});