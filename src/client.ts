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

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  let model = opts.model || 'auto';
  let content = '';
  let reasoning = '';
  let usage: ChatResult['usage'] = null;
  let finished = false;
  let errored = false;
  for await (const c of streamChat(messages, opts)) {
    if (c.model) model = c.model;
    if (c.delta?.content) content += c.delta.content;
    if (c.delta?.reasoning_content) reasoning += c.delta.reasoning_content;
    if (c.finished) finished = true;
    if (c.errored) errored = true;
    if (c.usage) usage = c.usage;
  }
  return {
    model,
    content,
    reasoning,
    usage,
    finish_reason: errored ? 'error' : finished ? 'stop' : 'error',
  };
}