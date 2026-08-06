import { describe, it, expect } from 'vitest';
import { toOpenAIChunks } from '../src/openai.js';
import type { OpenAIStreamEvent } from '../src/types.js';

function sseBody(events: string[], splitAt?: number[]): { [Symbol.asyncIterator]: () => AsyncGenerator<Uint8Array> } {
  const text = events.map((e) => `data: ${e}\n\n`).join('');
  const points = splitAt && splitAt.length ? splitAt : [text.length];
  const chunks: Uint8Array[] = [];
  let prev = 0;
  for (const p of points) {
    chunks.push(Buffer.from(text.slice(prev, p)));
    prev = p;
  }
  return {
    [Symbol.asyncIterator]() {
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
}

async function collect(events: string[], splitAt?: number[]): Promise<OpenAIStreamEvent[]> {
  const out: OpenAIStreamEvent[] = [];
  for await (const c of toOpenAIChunks({ body: sseBody(events, splitAt) } as Response, 'auto')) out.push(c);
  return out;
}

describe('toOpenAIChunks', () => {
  it('forwards assistant content from message events and patch ops', async () => {
    const events = [
      JSON.stringify({ type: 'input_message', input_message: { metadata: { resolved_model_slug: 'gpt-5-5-mini' } } }),
      JSON.stringify({
        type: 'message',
        v: {
          message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hello'] }, status: 'in_progress' },
        },
      }),
      JSON.stringify({ o: 'patch', v: [{ o: 'append', p: '/message/content/parts/0', v: ' world' }] }),
      JSON.stringify({ o: 'patch', v: [{ o: 'replace', p: '/message/status', v: 'finished_successfully' }] }),
    ];
    const chunks = await collect(events, [40, 220, textLength(events)]);
    expect(chunks[0]!.model).toBe('gpt-5-5-mini');
    expect(chunks[0]!.delta!.content).toBe('Hello');
    expect(chunks[1]!.delta!.content).toBe(' world');
    expect(chunks[chunks.length - 1]!.finished).toBe(true);
    expect(chunks[chunks.length - 1]!.assistantText).toBe('Hello world');
  });

  it('captures single-op events (unbatched patch form)', async () => {
    const events = [
      JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: 'Hello! How can I' }),
      JSON.stringify({ o: 'patch', v: [{ o: 'append', p: '/message/content/parts/0', v: ' help you today?' }] }),
      JSON.stringify({ p: '/message/status', o: 'replace', v: 'finished_successfully' }),
    ];
    const chunks = await collect(events);
    expect(chunks[0]!.delta!.content).toBe('Hello! How can I');
    expect(chunks[1]!.delta!.content).toBe(' help you today?');
    expect(chunks[chunks.length - 1]!.finished).toBe(true);
    expect(chunks[chunks.length - 1]!.assistantText).toBe('Hello! How can I help you today?');
  });

  it('captures bare-v continuation events (omitted o/p fields)', async () => {
    const events = [
      JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: 'Sure:' }),
      JSON.stringify({ v: ' the scarecrow win an award?' }),
      JSON.stringify({ o: 'patch', v: [{ o: 'append', p: '/message/content/parts/0', v: ' **nice**' }] }),
      JSON.stringify({ o: 'patch', v: [{ o: 'replace', p: '/message/status', v: 'finished_successfully' }] }),
    ];
    const chunks = await collect(events);
    expect(chunks[1]!.delta!.content).toBe(' the scarecrow win an award?');
    expect(chunks[chunks.length - 1]!.assistantText).toBe('Sure: the scarecrow win an award? **nice**');
  });

  it('extracts reasoning separately from assistant content', async () => {
    const events = [
      JSON.stringify({
        type: 'message',
        v: {
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'reasoning', content: 'thinking hard' },
            status: 'in_progress',
          },
        },
      }),
      JSON.stringify({ o: 'patch', v: [{ o: 'replace', p: '/message/end_turn', v: true }] }),
    ];
    const chunks = await collect(events);
    const reasoning = chunks.find((c) => c.delta?.reasoning_content);
    expect(reasoning!.delta!.reasoning_content).toBe('thinking hard');
  });

  it('marks the stream as errored when the upstream reports an error', async () => {
    const events = [
      JSON.stringify({
        type: 'message',
        v: { message: { author: { role: 'assistant' }, status: 'error', error: 'boom' } },
      }),
    ];
    const chunks = await collect(events);
    expect(chunks[chunks.length - 1]!.errored).toBe(true);
    expect(chunks[chunks.length - 1]!.finished).toBe(true);
  });

  it('appends a terminal chunk with usage', async () => {
    const events = [
      JSON.stringify({ type: 'message', v: { message: { author: { role: 'assistant' }, content: { parts: ['hi'] } } } }),
    ];
    const chunks = await collect(events);
    const last = chunks[chunks.length - 1]!;
    expect(last.delta).toBeNull();
    expect(last.usage).toBeDefined();
    expect(last.usage!.completion_tokens).toBeGreaterThan(0);
  });
});

function textLength(events: string[]): number {
  return events.map((e) => `data: ${e}\n\n`).join('').length;
}