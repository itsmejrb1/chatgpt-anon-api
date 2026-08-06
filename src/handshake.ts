import { randomUUID, randomInt } from 'crypto';

import { generateToken, solvePow, type DeviceConfig } from './challenges.js';
import { getTurnstile } from './vm.js';
import type { ChatMessage } from './types.js';

export const DEFAULT_BASE = process.env.ANON_BASE || 'https://android.chat.openai.com';

const UPSTREAM_TIMEOUT_MS = 120_000;
const QUICK_TIMEOUT_MS = 30_000;
const IP_LOOKUP_TIMEOUT_MS = 10_000;

export const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

export class AnonUpstreamError extends Error {
  status: number;
  upstream: string;

  constructor(status: number, upstreamMessage: string) {
    super(`upstream error ${status}: ${upstreamMessage}`);
    this.name = 'AnonUpstreamError';
    this.status = status;
    this.upstream = upstreamMessage;
  }
}

export class AnonRateLimitError extends AnonUpstreamError {
  constructor(upstreamMessage: string) {
    super(403, upstreamMessage);
    this.name = 'AnonRateLimitError';
  }
}

let ipInfoCache: { value: string; at: number } = { value: '', at: 0 };

export function newDeviceId(): string {
  const prefixes = ['12', '35', '9900'];
  const p = prefixes[randomInt(prefixes.length)]!;
  const len = 15 - p.length;
  return p + Array.from({ length: len }, () => randomInt(10)).join('');
}

export function buildConfig(): DeviceConfig {
  const now = new Date();
  const dateStr = now.toUTCString().replace('GMT', '+0000 (Coordinated Universal Time)');
  return [
    4880,
    dateStr,
    4294705152,
    0,
    UA,
    null,
    'prod',
    'en-US',
    'en-US,en;q=0.9',
    0,
    'webkitGetUserMedia\u2212function webkitGetUserMedia() { [native code] }',
    'location',
    'screen',
    1311.199,
    'session-' + Math.random().toString(36).slice(2),
    '',
    20,
    String(Date.now()),
  ];
}

export async function fetchIpInfo(): Promise<string> {
  if (ipInfoCache.value && Date.now() - ipInfoCache.at < 10 * 60 * 1000) return ipInfoCache.value;
  try {
    const r = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(IP_LOOKUP_TIMEOUT_MS) });
    const j = (await r.json()) as {
      success: boolean;
      ip?: string;
      city?: string;
      region?: string;
      latitude?: number;
      longitude?: number;
    };
    if (!j.success) throw new Error('ip lookup failed: ' + JSON.stringify(j));
    const info = `['${j.ip}', '${j.city}', '${j.region}', '${j.latitude}', '${j.longitude}']`;
    ipInfoCache = { value: info, at: Date.now() };
    return info;
  } catch {
    if (ipInfoCache.value) return ipInfoCache.value;
    const fallback = `['0.0.0.0', '', '', '0', '0']`;
    ipInfoCache = { value: fallback, at: Date.now() };
    return fallback;
  }
}

export function baseHeaders(deviceId: string, anonBase: string): Record<string, string> {
  return {
    Accept: '*/*',
    'Content-Type': 'application/json',
    'User-Agent': UA,
    'OAI-Device-Id': deviceId,
    'Oai-App-Name': 'com.openai.chatgpt',
    'Oai-Language': 'en-US',
    Origin: anonBase,
    Referer: anonBase + '/',
  };
}

function toUpstreamMessages(inputMessages: ChatMessage[]): Record<string, unknown>[] {
  return inputMessages.map((m, i) => {
    const role = m.role === 'system' ? 'developer' : m.role === 'assistant' ? 'assistant' : 'user';
    return {
      id: randomUUID(),
      author: { role },
      create_time: Date.now() / 1000 + i * 0.001,
      content: { content_type: 'text', parts: [String(m.content ?? '')] },
      metadata: {
        selected_github_repos: [],
        selected_all_github_repos: false,
        serialization_metadata: { custom_symbol_offsets: [] },
      },
    };
  });
}

export function buildConvBody(inputMessages: ChatMessage[], model = 'auto'): Record<string, unknown> {
  return {
    action: 'next',
    messages: toUpstreamMessages(inputMessages),
    parent_message_id: 'client-created-root',
    model,
    timezone_offset_min: 0,
    timezone: 'UTC',
    history_and_training_disabled: true,
    conversation_mode: { kind: 'primary_assistant' },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_contextual_info: {
      is_dark_mode: true,
      time_since_loaded: 3,
      page_height: 1219,
      page_width: 3440,
      pixel_ratio: 1,
      screen_height: 1440,
      screen_width: 3440,
    },
    paragen_cot_summary_display_override: 'allow',
    force_parallel_switch: 'auto',
  };
}

export async function runTurn(
  inputMessages: ChatMessage[],
  opts: { anonBase?: string; deviceId?: string; model?: string } = {},
): Promise<Response> {
  const anonBase = opts.anonBase || DEFAULT_BASE;
  const deviceId = opts.deviceId || newDeviceId();
  const model = opts.model || 'auto';
  const headers = baseHeaders(deviceId, anonBase);
  const config = buildConfig();

  const p = generateToken(config);
  const req = await fetch(`${anonBase}/backend-anon/sentinel/chat-requirements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p }),
    signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
  });
  let requirements: {
    token?: string;
    turnstile?: { required?: boolean; dx?: string };
    proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  } = {};
  try {
    requirements = (await req.json()) as typeof requirements;
  } catch {
    requirements = {};
  }
  if (!req.ok) {
    if (req.status === 403) throw new AnonRateLimitError(JSON.stringify(requirements));
    throw new AnonUpstreamError(req.status, JSON.stringify(requirements).slice(0, 300));
  }

  const token = requirements.token;
  const turnstile = requirements.turnstile || {};
  const pow = requirements.proofofwork || {};
  if (!turnstile.dx) throw new Error('turnstile required but no dx returned');

  const proof = solvePow(pow.seed || '', pow.difficulty || '', config);
  if (!proof) throw new Error('proof of work failed');

  const ipInfo = await fetchIpInfo();
  const turnstileToken = getTurnstile(turnstile.dx, p, ipInfo);

  const prepareRes = await fetch(`${anonBase}/backend-anon/f/conversation/prepare`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'next',
      fork_from_shared_post: false,
      parent_message_id: 'client-created-root',
      model,
      timezone_offset_min: 0,
      timezone: 'UTC',
      history_and_training_disabled: true,
      conversation_mode: { kind: 'primary_assistant' },
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ['v1'],
    }),
    signal: AbortSignal.timeout(QUICK_TIMEOUT_MS),
  });
  let prepare: { conduit_token?: string } = {};
  try {
    prepare = (await prepareRes.json()) as { conduit_token?: string };
  } catch {
    /* keep the empty default */
  }
  if (!prepareRes.ok) {
    if (prepareRes.status === 403) throw new AnonRateLimitError(JSON.stringify(prepare).slice(0, 300));
    throw new AnonUpstreamError(prepareRes.status, JSON.stringify(prepare).slice(0, 300));
  }
  const conduit = prepare.conduit_token;

  const response = await fetch(`${anonBase}/backend-anon/f/conversation`, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: 'text/event-stream',
      'Openai-Sentinel-Chat-Requirements-Token': token || '',
      'Openai-Sentinel-Proof-Token': proof,
      'Openai-Sentinel-Turnstile-Token': turnstileToken,
      'X-Conduit-Token': conduit || '',
    },
    body: JSON.stringify(buildConvBody(inputMessages, model)),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 403) throw new AnonRateLimitError(text.slice(0, 300));
    throw new AnonUpstreamError(response.status, text.slice(0, 300));
  }

  return response;
}