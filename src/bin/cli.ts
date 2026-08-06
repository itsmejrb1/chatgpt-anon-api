#!/usr/bin/env node
import { chat, streamChat, startServer, DEFAULT_BASE, AnonRateLimitError } from '../index.js';

const VERSION = '1.0.0';

function help(): void {
  console.log(`chatgpt-anon ${VERSION} - free, keyless, OpenAI-compatible ChatGPT API

USAGE
  chatgpt-anon serve [--port 3000] [--base URL]
      Start the OpenAI-compatible HTTP server (POST /v1/chat/completions,
      GET /v1/models, GET /health).

  chatgpt-anon chat "your message" [--stream]
      One-shot chat from the terminal (no server needed).

  chatgpt-anon health [--base http://localhost:3000]
      Check a running server.

  chatgpt-anon --version | --help

ENVIRONMENT
  PORT            server port (default 3000)
  ANON_BASE       upstream host (default https://android.chat.openai.com)

EXAMPLES
  npx chatgpt-anon serve
  npx chatgpt-anon chat "Explain quantum computing in one sentence"
  curl http://localhost:3000/v1/chat/completions -H "Content-Type: application/json" \\
       -d '{"model":"auto","messages":[{"role":"user","content":"Hi"}]}'
`);
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const has = (name: string): boolean => process.argv.includes(name);

async function cmdServe(): Promise<void> {
  const port = Number(arg('--port', process.env.PORT || '3000'));
  const base = arg('--base', process.env.ANON_BASE || DEFAULT_BASE);
  await startServer(port, base);
  console.log(`  OpenAI-compatible: http://localhost:${port}/v1/chat/completions`);
  console.log(`  health:            http://localhost:${port}/health`);
  console.log(`  upstream:          ${base}`);
}

async function cmdChat(): Promise<void> {
  const flags = new Set(['--stream', '--help', '--version', '-v']);
  const message = process.argv.slice(3).filter((a) => !flags.has(a)).join(' ').trim();
  const stream = has('--stream');
  if (!message) {
    console.error('error: nothing to say. usage: chatgpt-anon chat "your message" [--stream]');
    process.exit(1);
  }
  const messages = [{ role: 'user' as const, content: message }];
  try {
    if (stream) {
      for await (const c of streamChat(messages)) {
        if (c.delta?.content) process.stdout.write(c.delta.content);
        else if (c.delta?.reasoning_content) process.stdout.write(`\u001b[90m${c.delta.reasoning_content}\u001b[0m`);
      }
      process.stdout.write('\n');
    } else {
      const r = await chat(messages);
      if (r.reasoning) console.log(`\u001b[90m${r.reasoning}\u001b[0m\n`);
      console.log(r.content || '(no content)');
      console.log(`\u001b[90mmodel: ${r.model} | finish: ${r.finish_reason}\u001b[0m`);
    }
  } catch (e) {
    if (e instanceof AnonRateLimitError) {
      console.error(
        `\nrate limited by OpenAI (anonymous quota): ${e.upstream}\n\nTry again in a few minutes, or use a different public IP / proxy (set ANON_BASE to an alternative host).`,
      );
    } else {
      console.error('error:', e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
}

async function cmdHealth(): Promise<void> {
  const base = arg('--base', 'http://localhost:3000');
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/health`);
    const j = (await r.json()) as Record<string, unknown>;
    console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.status} ${Date.now() - t0}ms`, JSON.stringify(j));
  } catch (e) {
    console.error('health check failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const cmd = process.argv[2] || 'help';
void (async () => {
  switch (cmd) {
    case 'serve':
      return cmdServe();
    case 'chat':
      return cmdChat();
    case 'health':
      return cmdHealth();
    case '--version':
    case '-v':
      return console.log(VERSION);
    default:
      help();
  }
})();
