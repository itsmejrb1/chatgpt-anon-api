import { describe, it, expect, vi, afterEach } from 'vitest';
import { b64, xor, randint, getTurnstile, HTML_OBJECT, LOCALSTORAGE_STR, VENDOR_INFO, LOCATION } from '../src/vm.js';

vi.mock('../src/decompiler.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/decompiler.js')>();
  return { ...mod, Decompiler: { decompileVm: () => FIXTURE } };
});

const FIXTURE = [
  'var mem = {};',
  'var var_a = "k_num";',
  'var var_b = 5;',
  'var var_c = "k_loc";',
  'var var_d = "location";',
  'var var_e = "k_rnd";',
  'var var_f = "Math.random()";',
  'var var_g = "k_ven";',
  'var var_h = "navigator.maxTouchPoints";',
  'var var_i = "k_ip";',
  'var var_j = "cfIpLongitude";',
  'var var_k = "k_hist";',
  'var var_l = "history.length";',
  'var var_m = "k_ls";',
  'var var_n = `window["Object"]["keys"]`;',
  'var var_o = "k_el";',
  'var var_p = "document.createElement";',
  'var var_q = "k_dx";',
  'var var_r = "doublexor(5)";',
  'var var_seed = "secret";',
  'var payload = {};',
  'var var_out = XOR_STR(var_a, var_seed);',
  'JSON.stringify(payload);',
  'payload[var_a] = var_b;',
  'payload[var_c] = var_d;',
  'payload[var_e] = var_f;',
  'payload[var_g] = var_h;',
  'payload[var_i] = var_j;',
  'payload[var_k] = var_l;',
  'payload[var_m] = var_n;',
  'payload[var_o] = var_p;',
  'payload[var_q] = var_r;',
].join('\n');

function decodeTurnstile(token: string, xorKey: string): Record<string, unknown> {
  const raw = Buffer.from(token, 'base64').toString('utf8');
  return JSON.parse(xor(raw, xorKey)) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('xor / b64', () => {
  it('round-trips through a key', () => {
    expect(xor(xor('hello world', 'key'), 'key')).toBe('hello world');
  });

  it('b64 encodes utf8', () => {
    expect(Buffer.from(b64('hi'), 'base64').toString('utf8')).toBe('hi');
  });
});

describe('randint', () => {
  it('returns min when random is 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randint(1, 5)).toBe(1);
  });

  it('returns max when random is ~1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(randint(1, 5)).toBe(5);
  });
});

describe('getTurnstile', () => {
  const XOR_KEY = 'secret';
  const IP = "['1.2.3.4', 'NY', 'NY', 40.7, -74.0]";

  it('builds a payload keyed by the turnstile variables', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const token = getTurnstile('fake-dx', 'fake-p', IP);
    const payload = decodeTurnstile(token, XOR_KEY);

    expect(payload.k_num).toBe(b64(xor('5', XOR_KEY)));
    expect(payload.k_loc).toBe(b64(xor(LOCATION, XOR_KEY)));
    expect(payload.k_ven).toBe(b64(xor(VENDOR_INFO, XOR_KEY)));
    expect(payload.k_ip).toBe(b64(xor(IP, XOR_KEY)));
    expect(payload.k_hist).toBe(b64(xor('3', XOR_KEY))); // randint(1,5) with random 0.5
    expect(payload.k_ls).toBe(b64(xor(LOCALSTORAGE_STR, XOR_KEY)));
    expect(payload.k_el).toBe(b64(xor(HTML_OBJECT, XOR_KEY)));
    const number = '5';
    const value1 = b64(xor(number, number));
    const value2 = b64(xor(value1, value1));
    expect(payload.k_dx).toBe(b64(value2));
    const rnd = Buffer.from(payload.k_rnd as string, 'base64');
    expect(rnd.length).toBeGreaterThan(0);
    expect(rnd.every((byte) => byte === 0)).toBe(true);
  });
});