import { describe, it, expect } from 'vitest';
import { Decompiler, pyFloat, pyStr } from '../src/decompiler.js';

describe('pyStr', () => {
  it('mirrors python string representations', () => {
    expect(pyStr(null)).toBe('None');
    expect(pyStr(true)).toBe('True');
    expect(pyStr(false)).toBe('False');
    expect(pyStr(42)).toBe('42');
    expect(pyStr([1, 'a', null])).toBe('[1, a, None]');
    expect(pyStr({ a: 1 })).toBe("{'a': 1}");
  });
});

describe('pyFloat', () => {
  it('parses python floats', () => {
    expect(pyFloat('42')).toBe(42);
    expect(pyFloat('-0.5e3')).toBe(-500);
    expect(pyFloat('inf')).toBe(Infinity);
    expect(pyFloat('-inf')).toBe(-Infinity);
    expect(Number.isNaN(pyFloat('nan'))).toBe(true);
  });

  it('throws for non-numeric input', () => {
    expect(() => pyFloat('')).toThrow();
    expect(() => pyFloat('abc')).toThrow();
  });

  it('passes non-strings through untouched', () => {
    expect(pyFloat(7)).toBe(7);
  });
});

describe('Decompiler.handleOperation', () => {
  it('turns SET_VALUE into a typed variable declaration', () => {
    const d = new Decompiler();
    d.start();
    d.handleOperation('SET_VALUE', ['a', '5']);
    expect(d.decompiled).toContain('var var_a = 5;');
  });

  it('keeps non-numeric SET_VALUE strings quoted', () => {
    const d = new Decompiler();
    d.start();
    d.handleOperation('SET_VALUE', ['b', 'hello']);
    expect(d.decompiled).toContain('var var_b = "hello";');
  });

  it('emits XOR_STR calls', () => {
    const d = new Decompiler();
    d.start();
    d.handleOperation('XOR_STR', ['x', 'key']);
    expect(d.decompiled).toContain('var var_x = XOR_STR(var_x, var_key);');
  });

  it('emits JSON.stringify calls', () => {
    const d = new Decompiler();
    d.start();
    d.handleOperation('JSON_STRINGIFY', ['payload']);
    expect(d.decompiled).toContain('var var_payload = JSON.stringify(var_payload);');
  });

  it('emits IF_DEFINED_CALL fallback logic', () => {
    const d = new Decompiler();
    d.start();
    d.handleOperation('SET_VALUE', ['pair', '1']);
    d.handleOperation('IF_DEFINED_CALL', ['out', '13', 'pair', 'mykey']);
    expect(d.decompiled).toContain('(var_pair, mem["mykey"])');
    expect(d.decompiled).toMatch(/var var_out = var_out !== void 0 \?/);
  });
});

describe('Decompiler.decompile', () => {
  it('round-trips a tiny bytecode program without throwing', () => {
    const d = new Decompiler();
    d.start();
    expect(() => d.decompile([[2, 'aa', '1']])).not.toThrow();
    expect(d.decompiled).toContain('var mem = {};');
  });

  it('flags unknown opcodes as comments', () => {
    const d = new Decompiler();
    d.start();
    d.decompile([[99, 'x']]);
    expect(d.decompiled).toContain('// UNKNOWN_OPCODE');
  });
});

describe('Decompiler.decompileVm', () => {
  it('decodes an encoded bytecode blob', () => {
    const token = 'tok';
    const encoded = Buffer.from(Decompiler.prototype.xS(JSON.stringify([[2, 'v', '7']]), token), 'utf8').toString('base64');
    const out = Decompiler.decompileVm(encoded, token);
    expect(out).toContain('var mem = {};');
  });
});