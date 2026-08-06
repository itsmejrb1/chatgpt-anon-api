export type DeviceConfig = Array<string | number | null>;

export function encode(e: DeviceConfig): string {
  return Buffer.from(JSON.stringify(e), 'utf8').toString('base64');
}

export function generateToken(config: DeviceConfig): string {
  try {
    config[3] = 1;
    return 'gAAAAAC' + encode(config);
  } catch (err) {
    return 'error_' + encode([String(err)]);
  }
}

/** FNV-1a 32-bit with a 3-step avalanche mix, hex-encoded. */
export function mod(e: string): string {
  let t = 2166136261;
  for (let i = 0; i < e.length; i++) {
    t ^= e.charCodeAt(i);
    t = Math.imul(t, 16777619) >>> 0;
  }
  t ^= t >>> 16;
  t = Math.imul(t, 2246822507) >>> 0;
  t ^= t >>> 13;
  t = Math.imul(t, 3266489909) >>> 0;
  t ^= t >>> 16;
  return (t >>> 0).toString(16).padStart(8, '0');
}

function runCheck(t0: number, seed: string, difficulty: string, nonce: number, config: DeviceConfig): string | null {
  config[3] = nonce;
  config[9] = Math.round(Date.now() - t0);
  const encoded = encode(config);
  if (mod(seed + encoded).slice(0, difficulty.length) <= difficulty) return `${encoded}~S`;
  return null;
}

export function solvePow(
  seed: string,
  difficulty: string,
  config: DeviceConfig,
  maxIter = 500000,
): string | null {
  const t0 = Date.now();
  for (let i = 0; i < maxIter; i++) {
    const a = runCheck(t0, seed, difficulty, i, config);
    if (a) return 'gAAAAAB' + a;
  }
  return null;
}

export { runCheck };