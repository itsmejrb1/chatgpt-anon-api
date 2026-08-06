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
  let n = '';
  for (let r = 0; r < e.length; r++) {
    n += String.fromCharCode(e.charCodeAt(r) ^ t.charCodeAt(r % t.length));
  }
  return n;
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

  for (const [key0, value0] of Object.entries(keys)) {
    const value = value0;
    const num = Number(value);
    const isNumeric = !isNaN(num) && String(value).trim() !== '';

    if (isNumeric) {
      payload[key0] = b64(xor(String(num), String(xorKey)));
    } else if (value.includes('singlebtoa')) {
      payload[key0] = b64(value.split('singlebtoa(')[1]!.split(')')[0]!);
    } else if (value.includes('doublexor')) {
      const number = value.split('doublexor(')[1]!.split(')')[0]!;
      const value1 = b64(xor(number, number));
      const value2 = b64(xor(value1, value1));
      payload[key0] = b64(value2);
    } else if (value.includes('ipinfo')) {
      payload[key0] = b64(xor(ipInfo, String(xorKey)));
    } else if (value.includes('element')) {
      payload[key0] = b64(xor(HTML_OBJECT, String(xorKey)));
    } else if (value.includes('location')) {
      payload[key0] = b64(xor(LOCATION, String(xorKey)));
    } else if (value.includes('random_1')) {
      const randomValue = Math.random();
      payload[key0] = b64(xor(String(randomValue), String(randomValue)));
    } else if (value.includes('random_2')) {
      payload[key0] = Math.random();
    } else if (value.includes('vendor')) {
      payload[key0] = b64(xor(VENDOR_INFO, String(xorKey)));
    } else if (value.includes('localstorage')) {
      payload[key0] = b64(xor(LOCALSTORAGE_STR, String(xorKey)));
    } else if (value.includes('history')) {
      payload[key0] = b64(xor(String(randint(1, 5)), String(xorKey)));
    } else {
      console.log(`UNKNOWN ITEM ${key0},${value0}`);
    }
  }

  return b64(xor(JSON.stringify(payload), String(xorKey)));
}