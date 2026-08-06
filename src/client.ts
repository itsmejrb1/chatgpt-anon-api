import { setTimeout as sleep } from 'node:timers/promises';

import { runTurn } from './handshake.js';
import { toOpenAIChunks } from './openai.js';
import type { ChatMessage, ChatOptions, ChatResult, OpenAIStreamEvent } from './types.js';

export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<OpenAIStreamEvent> {
  const response = await runTurn(messages, opts);
  yield* toOpenAIChunks(response, opts.model || 'auto');
}

/** Raw upstream SSE payloads (each `data:` line, parsed JSON, unmodified). */
export async function* streamRaw(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<unknown> {
  const response = await runTurn(messages, opts);
  let pending = Buffer.alloc(0);
  for await (const chunk of response.body!) {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let idx: number;
    while ((idx = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, idx).toString('utf8').trim();
      pending = pending.subarray(idx + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      yield parsed;
    }
  }
}

/** Raw turn result: every content part of the final message, concatenated. */
export async function chatRaw(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  let model = opts.model || 'auto';
  let content = '';
  let reasoning = '';
  let usage: ChatResult['usage'] = null;
  for await (const c of streamChat(messages, opts)) {
    if (c.model) model = c.model;
    if (c.usage) usage = c.usage;
    content = c.assistantText;
    reasoning = c.reasoningText;
  }
  return { model, content, reasoning, usage, finish_reason: content ? 'stop' : 'error' };
}

function looksTruncated(content: string): boolean {
  const t = content.trimEnd();
  if (!t) return true;
  const last = t[t.length - 1]!;
  if (/[.!?…"')}\]]/.test(last)) return false;
  if (/[\w\d]/.test(last)) return true;
  return false;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const retries = Math.max(0, opts.retries ?? 2);
  const retryTruncated = opts.retryTruncated ?? true;

  let last: ChatResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(attempt * 1500);
    try {
      const result = await chatRaw(messages, opts);
      last = result;
      if (result.finish_reason === 'error') continue;
      if (!result.content.trim()) continue;
      if (retryTruncated && looksTruncated(result.content)) continue;
      return result;
    } catch (e) {
      last = null;
      if (attempt === retries) throw e;
    }
  }
  return last!;
}