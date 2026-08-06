import type { OpenAIStreamEvent, OpenAIDelta, Usage } from './types.js';

function usageOf(assistantText: string, reasoningText: string): Usage {
  return {
    prompt_tokens: 0,
    completion_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
    total_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
  };
}

export async function* toOpenAIChunks(response: Response, initialModel: string): AsyncGenerator<OpenAIStreamEvent> {
  let model = initialModel;
  let assistantText = '';
  let reasoningText = '';
  let finished = false;
  let errored = false;
  let pending = Buffer.alloc(0);

  const yieldDelta = (delta: OpenAIDelta | null, isFinished = finished, isErrored = errored): void => {
    // placeholder kept for clarity; all yields happen inline below
    void delta;
    void isFinished;
    void isErrored;
  };

  for await (const chunk of response.body!) {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let idx: number;
    while ((idx = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, idx).toString('utf8').trim();
      pending = pending.subarray(idx + 1);
      if (line === '') continue;
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      if (msg.type === 'input_message' && msg.input_message && msg.input_message.metadata) {
        model = msg.input_message.metadata.resolved_model_slug || model;
      }
      if (msg.o === 'patch' && Array.isArray(msg.v)) {
        for (const op of msg.v) {
          if (!op || typeof op !== 'object') continue;
          if (
            op.o === 'append' &&
            typeof op.p === 'string' &&
            /^\/message\/content\/parts\/\d+$/.test(op.p) &&
            typeof op.v === 'string'
          ) {
            assistantText += op.v;
            yield {
              model,
              delta: { role: 'assistant', content: op.v },
              finished: false,
              errored: false,
              assistantText,
              reasoningText,
            };
          }
          if (op.o === 'replace' && op.p === '/message/status' && op.v === 'finished_successfully') finished = true;
          if (op.o === 'replace' && op.p === '/message/end_turn' && op.v === true) finished = true;
        }
        continue;
      }
      const v = msg.v;
      if (!v || !v.message) continue;
      const content = v.message.content || {};
      const parts = content.parts || [];
      let textPart: string | null = null;
      for (const part of parts) {
        if (typeof part === 'string') {
          textPart = part;
          break;
        }
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          textPart = part.text;
          break;
        }
      }
      if (textPart === null) {
        if (content.content_type && String(content.content_type).includes('reasoning')) {
          const c = content.content;
          if (typeof c === 'string') textPart = c;
          else if (Array.isArray(c)) {
            const joined = c
              .map((x: unknown) => (typeof x === 'string' ? x : (x as { text?: string }).text))
              .filter(Boolean)
              .join('');
            if (joined) textPart = joined;
          }
        }
      }
      if (textPart === null || textPart === undefined) {
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

  void yieldDelta;
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