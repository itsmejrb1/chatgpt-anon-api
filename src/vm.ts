import { Decompiler } from './decompiler.js';
import { parseKeys } from './parser.js';

export const HTML_OBJECT = JSON.stringify({
  x: 0,
  y: 1219,
  width: 37.8125,
  height: 30,
  top: 1219,
  right: 37.8125,
  bottom: 1249,
  left: 0,
});

export const LOCALSTORAGE_STR =
  'oai/apps/hasDismissedTeamsNoAuthUpsell,oai/apps/lastSeenNoAuthTrialsBannerAt,oai-did,' +
  'oai/apps/noAuthGoUpsellModalDismissed,oai/apps/hasDismissedBusinessFreeTrialUpsellModal,' +
  'oai/apps/capExpiresAt,statsig.session_id.1792610830,oai/apps/hasSeenNoAuthImagegenNux,' +
  'oai/apps/lastPageLoadDate,client-correlated-secret,statsig.stable_id.1792610830,' +
  'oai/apps/debugSettings,oai/apps/hasDismissedPlusFreeTrialUpsellModal,' +
  'oai/apps/tatertotInContextUpsellBannerV2,search.attributions-settings';

export const VENDOR_INFO = '["Google Inc.","Win32",8,0]';
export const LOCATION = 'https://chatgpt.com/';

export function xor(e: string, t: string): string {
  const out = new Array<string>(e.length);
  for (let r = 0; r < e.length; r++) {
    out[r] = String.fromCharCode(e.charCodeAt(r) ^ t.charCodeAt(r % t.length));
  }
  return out.join('');
}

export function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

export function randint(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function getTurnstile(turnstileDx: string, token: string, ipInfo: string): string {
  const decompiled = Decompiler.decompileVm(turnstileDx, token);

  const [xorKey, keys] = parseKeys(decompiled);

  const payload: Record<string, string | number> = {};

  const handlers: Array<[marker: string, run: (v: string) => string | number | null]> = [
    ['singlebtoa', (v) => b64(v.split('singlebtoa(')[1]!.split(')')[0]!)],
    [
      'doublexor',
      (v) => {
        const number = v.split('doublexor(')[1]!.split(')')[0]!;
        return b64(b64(xor(b64(xor(number, number)), b64(xor(number, number)))));
      },
    ],
    ['ipinfo', () => b64(xor(ipInfo, String(xorKey)))],
    ['element', () => b64(xor(HTML_OBJECT, String(xorKey)))],
    ['location', () => b64(xor(LOCATION, String(xorKey)))],
    ['random_1', () => b64(xor(String(Math.random()), String(Math.random())))],
    ['random_2', () => Math.random()],
    ['vendor', () => b64(xor(VENDOR_INFO, String(xorKey)))],
    ['localstorage', () => b64(xor(LOCALSTORAGE_STR, String(xorKey)))],
    ['history', () => b64(xor(String(randint(1, 5)), String(xorKey)))],
  ];

  for (const [key0, value0] of Object.entries(keys)) {
    const value = value0;
    const num = Number(value);
    const isNumeric = !isNaN(num) && String(value).trim() !== '';

    if (isNumeric) {
      payload[key0] = b64(xor(String(num), String(xorKey)));
      continue;
    }
    const handler = handlers.find(([marker]) => value.includes(marker));
    if (handler) {
      payload[key0] = handler[1](value)!;
    } else {
      console.log(`UNKNOWN ITEM ${key0},${value0}`);
    }
  }

  return b64(xor(JSON.stringify(payload), String(xorKey)));
}