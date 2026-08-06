import { describe, it, expect, vi, afterEach } from 'vitest';
import { runTurn, AnonRateLimitError, AnonUpstreamError } from '../src/handshake.js';
import { solvePow } from '../src/challenges.js';
import type { ChatMessage } from '../src/types.js';

vi.mock('../src/challenges.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/challenges.js')>();
  return { ...mod, solvePow: vi.fn(() => 'gAAAAABproof') };
});

vi.mock('../src/vm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/vm.js')>();
  return { ...mod, getTurnstile: vi.fn(() => 'turnstile_fake') };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function conversationResponse(): Response {
  const body = {
    [Symbol.asyncIterator]() {
      return (async function* () {
        yield Buffer.from('data: {"type":"message","message":{"role":"assistant","content":{"parts":["ok"]},"status":"finished_successfully","end_turn":true}}\n\n');
      })();
    },
  };
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runTurn', () => {
  it('walks the full handshake and forwards the conversation response', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const u = String(url);
        if (u.includes('chat-requirements'))
          return jsonResponse(200, {
            token: 't1',
            turnstile: { required: true, dx: 'dx1' },
            proofofwork: { required: true, seed: 's', difficulty: 'f' },
          });
        if (u.includes('ipwho.is')) return jsonResponse(200, { success: true, ip: '1.2.3.4' });
        if (u.includes('prepare')) return jsonResponse(200, { conduit_token: 'conduit_1' });
        if (u.includes('f/conversation')) return conversationResponse();
        return jsonResponse(404, {});
      }),
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hello' },
    ];
    const r = await runTurn(messages, { anonBase: 'https://example.test', deviceId: '123456789012345' });

    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    expect(calls.length).toBe(4);
    expect(calls[0]!.url).toContain('/backend-anon/sentinel/chat-requirements');
    expect(calls[2]!.url).toContain('/backend-anon/f/conversation/prepare');
    expect(calls[3]!.url).toContain('/backend-anon/f/conversation');

    const convInit = calls[3]!.init!;
    const convHeaders = convInit.headers as Record<string, string>;
    expect(convHeaders['OAI-Device-Id']).toBe('123456789012345');
    expect(convHeaders['Openai-Sentinel-Proof-Token']).toBe('gAAAAABproof');
    expect(convHeaders['Openai-Sentinel-Turnstile-Token']).toBe('turnstile_fake');
    expect(convHeaders['X-Conduit-Token']).toBe('conduit_1');
    expect(convHeaders['Openai-Sentinel-Chat-Requirements-Token']).toBe('t1');

    const convBody = JSON.parse(String(convInit.body)) as { messages: Array<{ author: { role: string } }> };
    expect(convBody.messages[0]!.author.role).toBe('developer'); // system -> developer
    expect(convBody.messages[1]!.author.role).toBe('user');
    expect(solvePow).toHaveBeenCalled();
  });

  it('throws AnonRateLimitError on a 403 from chat-requirements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('chat-requirements')) return jsonResponse(403, { error: 'rate' });
        return jsonResponse(200, { success: true });
      }),
    );
    await expect(runTurn([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(AnonRateLimitError);
  });

  it('throws AnonUpstreamError on other upstream failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return jsonResponse(500, { error: 'boom' });
      }),
    );
    await expect(runTurn([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(AnonUpstreamError);
  });

  it('rejects when proof of work cannot be solved', async () => {
    vi.mocked(solvePow).mockReturnValueOnce(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('chat-requirements'))
          return jsonResponse(200, { token: 't1', turnstile: { dx: 'dx1' }, proofofwork: { seed: 's', difficulty: 'zz' } });
        if (u.includes('ipwho.is')) return jsonResponse(200, { success: true });
        if (u.includes('prepare')) return jsonResponse(200, { conduit_token: 'c' });
        return jsonResponse(200, {});
      }),
    );
    await expect(runTurn([{ role: 'user', content: 'x' }])).rejects.toThrow('proof of work failed');
  });
});