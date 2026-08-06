import type { OpenAIStreamEvent, Usage } from './types.js';

export function usageOf(assistantText: string, reasoningText: string): Usage {
  return {
    prompt_tokens: 0,
    completion_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
    total_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
  };
}

interface UpstreamOp {
  o?: string;
  p?: string;
  v?: unknown;
}

interface InputMessageEvent {
  type?: string;
  input_message?: { metadata?: { resolved_model_slug?: string } };
}

interface MessageEnvelope {
  v?: {
    message?: {
      author?: { role?: string };
      content?: {
        content_type?: string;
        parts?: unknown[];
        content?: unknown;
      };
      status?: string;
      end_turn?: boolean;
      error?: unknown;
    };
  };
}

type UpstreamEvent = Partial<InputMessageEvent & MessageEnvelope & UpstreamOp>;

function textOfPart(part: unknown): string | null {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
    return (part as { text: string }).text;
  }
  return null;
}

export async function* toOpenAIChunks(response: Response, initialModel: string): AsyncGenerator<OpenAIStreamEvent> {
  const body = response.body;
  if (!body) throw new Error('upstream response has no body');
  let model = initialModel;
  let assistantText = '';
  let reasoningText = '';
  let finished = false;
  let errored = false;
  let pending = Buffer.alloc(0);
  let lastPart: string | null = null;

  const handleOp = function* (op: UpstreamOp): Generator<OpenAIStreamEvent> {
    if (!op || typeof op !== 'object') return;
    if (typeof op.p === 'string' && /^\/message\/content\/parts\/\d+$/.test(op.p) && typeof op.v === 'string') {
      lastPart = op.p;
      assistantText += op.v;
      yield {
        model,
        delta: { role: 'assistant', content: op.v },
        finished: false,
        errored: false,
        assistantText,
        reasoningText,
      };
      return;
    }
    if (op.o === 'replace' && op.p === '/message/status' && op.v === 'finished_successfully') finished = true;
    if (op.o === 'replace' && op.p === '/message/end_turn' && op.v === true) finished = true;
  };

  for await (const chunk of body) {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let idx: number;
    while ((idx = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, idx).toString('utf8').trim();
      pending = pending.subarray(idx + 1);
      if (line === '') continue;
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const msg = parsed as UpstreamEvent;
      if (msg.type === 'input_message' && msg.input_message?.metadata?.resolved_model_slug) {
        model = msg.input_message.metadata.resolved_model_slug;
      }
      if (typeof msg.o === 'string' && Array.isArray(msg.v) && typeof msg.p === 'undefined') {
        for (const op of msg.v) yield* handleOp(op as UpstreamOp);
        continue;
      }
      if (typeof msg.o === 'string' && typeof msg.p === 'string') {
        yield* handleOp(msg);
        continue;
      }
      if (typeof msg.v === 'string') {
        if (lastPart !== null) yield* handleOp({ o: 'append', p: lastPart, v: msg.v });
        continue;
      }
      const v = msg.v;
      if (!v || !v.message) continue;
      const content = v.message.content || {};
      const parts = content.parts || [];
      let textPart: string | null = null;
      for (const part of parts) {
        textPart = textOfPart(part);
        if (textPart !== null) break;
      }
      if (textPart === null) {
        if (content.content_type && String(content.content_type).includes('reasoning')) {
          const c = content.content;
          if (typeof c === 'string') textPart = c;
          else if (Array.isArray(c)) {
            const joined = c
              .map((x: unknown) => textOfPart(x))
              .filter((x): x is string => x !== null)
              .join('');
            if (joined) textPart = joined;
          }
        }
      }
      if (textPart === null) {
        if (v.message.status === 'error' || v.message.error) {
          errored = true;
          finished = true;
          yield {
            model,
            delta: null,
            finished: true,
            errored: true,
            assistantText,
            reasoningText,
          };
        }
        continue;
      }
      if (v.message.author && v.message.author.role === 'assistant') {
        const isReasoning = content.content_type && String(content.content_type).includes('reasoning');
        if (isReasoning) {
          reasoningText += textPart;
          yield {
            model,
            delta: { role: 'assistant', reasoning_content: textPart },
            finished: false,
            errored: false,
            assistantText,
            reasoningText,
          };
        } else {
          assistantText += textPart;
          yield {
            model,
            delta: { role: 'assistant', content: textPart },
            finished: false,
            errored: false,
            assistantText,
            reasoningText,
          };
        }
      }
      if (v.message.status === 'finished_successfully' && v.message.end_turn === true) finished = true;
      if (v.message.error) {
        errored = true;
        finished = true;
        yield {
          model,
          delta: null,
          finished: true,
          errored: true,
          assistantText,
          reasoningText,
        };
      }
    }
  }
  yield {
    model,
    delta: null,
    finished,
    errored,
    assistantText,
    reasoningText,
    usage: usageOf(assistantText, reasoningText),
  };
}