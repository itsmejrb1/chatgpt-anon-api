import http from 'http';
import { randomInt } from 'crypto';
import { pathToFileURL } from 'url';

import { runTurn, DEFAULT_BASE, AnonRateLimitError, AnonUpstreamError } from './handshake.js';
import { toOpenAIChunks } from './openai.js';
import type { ChatMessage, Usage } from './types.js';

const PORT = Number(process.env.PORT || 3000);

interface CompletionBody {
  messages?: ChatMessage[];
  stream?: boolean;
  model?: string;
}

function openaiChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: Usage,
): Record<string, unknown> {
  const chunk: Record<string, unknown> = {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: delta || {}, finish_reason: finishReason ?? null }],
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

function writeJson(res: http.ServerResponse, status: number, obj: unknown): void {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function sendError(res: http.ServerResponse, e: unknown): void {
  const status =
    e instanceof AnonRateLimitError ? 429 : e instanceof AnonUpstreamError ? 502 : 500;
  const type = status === 429 ? 'rate_limit' : status === 502 ? 'upstream_error' : 'internal_error';
  const message = e instanceof Error ? e.message : String(e);
  writeJson(res, status, { error: { message, type, status } });
}

export function createAnonServer(anonBase: string = DEFAULT_BASE): http.Server {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      writeJson(res, 200, {
        object: 'list',
        data: [
          { id: 'gpt-5-5', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5-5-mini', object: 'model', owned_by: 'openai' },
          { id: 'auto', object: 'model', owned_by: 'openai' },
        ],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body: CompletionBody = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
      const messages: ChatMessage[] = Array.isArray(body.messages)
        ? body.messages.map((m) => ({
            role: (m?.role ?? 'user') as ChatMessage['role'],
            content: String(m?.content ?? ''),
          }))
        : [{ role: 'user', content: '' }];
      const stream = body.stream !== false;
      const requestedModel = typeof body.model === 'string' ? body.model : 'auto';

      let response: Response;
      try {
        response = await runTurn(messages, { anonBase });
      } catch (e) {
        sendError(res, e);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const text = await response.text();
        writeJson(res, 502, {
          error: { message: 'unexpected upstream response: ' + text.slice(0, 500), type: 'upstream_error', status: 502 },
        });
        return;
      }

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
      }

      const runId = randomInt(1e9).toString(36);
      const emit = (chunk: Record<string, unknown>): void => {
        try {
          if (stream && res.writableEnded === false) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } catch (e) {
          console.error('emit failed', (e as Error).message);
        }
      };

      let model = requestedModel;
      let assistantText = '';
      let reasoningText = '';
      let finished = false;
      let errored = false;
      let usage: Usage | null = null;

      try {
        for await (const c of toOpenAIChunks(response, requestedModel)) {
          if (c.model) model = c.model;
          assistantText = c.assistantText;
          reasoningText = c.reasoningText;
          if (c.errored) errored = true;
          if (c.finished) finished = true;
          if (c.usage) usage = c.usage;
          if (c.delta) emit(openaiChunk(runId, model, c.delta as Record<string, unknown>, null));
        }
      } catch (e) {
        console.error('stream error', e);
      }

      const fallbackUsage: Usage = {
        prompt_tokens: 0,
        completion_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
        total_tokens: Math.max(1, Math.round((assistantText.length + reasoningText.length) / 4)),
      };

      if (stream) {
        emit(
          openaiChunk(
            runId,
            model,
            {},
            finished && !errored ? 'stop' : 'error',
            usage || fallbackUsage,
          ),
        );
        try {
          if (res.writableEnded === false) res.write('data: [DONE]\n\n');
        } catch (e) {
          console.error('final write failed', (e as Error).message);
        }
      } else {
        writeJson(res, 200, {
          id: `chatcmpl-${runId}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: assistantText || null,
                reasoning_content: reasoningText || null,
              },
              finish_reason: errored ? 'error' : finished ? 'stop' : 'error',
            },
          ],
          usage: usage || fallbackUsage,
        });
        return;
      }
      res.end();
      return;
    }

    writeJson(res, 404, { error: { message: 'not found', type: 'not_found' } });
  });
}

export function startServer(port: number = PORT, anonBase: string = DEFAULT_BASE): Promise<http.Server> {
  const server = createAnonServer(anonBase);
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`chatgpt-anon proxy listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = await startServer(PORT, DEFAULT_BASE);
  process.on('uncaughtException', (err) => console.error('uncaughtException', err));
  process.on('unhandledRejection', (reason) => console.error('unhandledRejection', reason));
  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
