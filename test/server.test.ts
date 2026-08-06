import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAnonServer } from '../src/server.js';

vi.mock('../src/handshake.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/handshake.js')>();
  return { ...mod, runTurn: vi.fn() };
});

import { runTurn } from '../src/handshake.js';

function fakeUpstream(): Response {
  const body = {
    [Symbol.asyncIterator]() {
      return (async function* () {
        yield Buffer.from(
          'data: {"type":"message","v":{"message":{"author":{"role":"assistant"},"content":{"parts":["PASS"]},"status":"finished_successfully","end_turn":true}}}\n\n',
        );
      })();
    },
  };
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createAnonServer('https://example.test');
  await new Promise<void>((ok) => server.listen(0, ok));
  const address = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAnonServer', () => {
  it('answers /health and /v1/models', async () => {
    await withServer(async (base) => {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const models = await fetch(`${base}/v1/models`);
      expect(models.status).toBe(200);
      const j = (await models.json()) as { data: Array<{ id: string }> };
      expect(j.data.some((m) => m.id === 'gpt-5-5-mini')).toBe(true);
    });
  });

  it('proxies non-stream completions', async () => {
    vi.mocked(runTurn).mockResolvedValueOnce(fakeUpstream());
    await withServer(async (base) => {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream: false,
          model: 'auto',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      expect(r.status).toBe(200);
      const j = (await r.json()) as {
        choices: Array<{ message: { content: string; reasoning_content: string | null }; finish_reason: string }>;
      };
      expect(j.choices[0]!.message.content).toBe('PASS');
      expect(j.choices[0]!.finish_reason).toBe('stop');
    });
  });

  it('streams SSE chunks ending with [DONE]', async () => {
    vi.mocked(runTurn).mockResolvedValueOnce(fakeUpstream());
    await withServer(async (base) => {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(text).toContain('"content":"PASS"');
      expect(text).toContain('data: [DONE]');
      expect(text).toContain('"finish_reason":"stop"');
    });
  });

  it('maps rate-limit errors to 429', async () => {
    const { AnonRateLimitError } = await import('../src/handshake.js');
    vi.mocked(runTurn).mockRejectedValueOnce(new AnonRateLimitError('quota'));
    await withServer(async (base) => {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(r.status).toBe(429);
    });
  });

  it('404s unknown paths', async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/nope`);
      expect(r.status).toBe(404);
    });
  });

  it('rejects oversized request bodies with 413', async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(11 * 1024 * 1024) }] }),
      });
      expect(r.status).toBe(413);
      const j = (await r.json()) as { error: { type: string } };
      expect(j.error.type).toBe('request_too_large');
    });
  });
});