# chatgpt-anon-api

**Free, keyless, OpenAI-compatible ChatGPT API.** No account. No API key. No browser.
Just Node.js.

Every request auto-solves the full anonymous device-proof challenge stack the
ChatGPT Android app uses — the sentinel handshake, proof-of-work, and the
turnstile fingerprint VM — so you get real model responses through OpenAI's
anonymous chat backend (`gpt-5-5` / `gpt-5-5-mini`).

Reverse-engineered from the ChatGPT Android app (`chatgpt-1-2026-209.xapk`) and
cross-checked against [realasfngl/ChatGPT](https://github.com/realasfngl/ChatGPT).

## Quick start

```bash
npx chatgpt-anon-api serve
```

Install (npm registry once published, GitHub meanwhile):

```bash
npm install github:itsmejrb1/chatgpt-anon-api
```

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","stream":true,"messages":[{"role":"user","content":"Hello!"}]}'
```

One-liner from the terminal (no server):

```bash
npx chatgpt-anon-api chat "Explain quantum computing in one sentence"
```

## OpenAI-compatible API

| Endpoint | Description |
| --- | --- |
| `POST /v1/chat/completions` | Chat completions, stream & non-stream (drop-in `chat.completion.chunk` SSE) |
| `GET /v1/models` | `gpt-5-5`, `gpt-5-5-mini`, `auto` |
| `GET /health` | Liveness probe |

Works with any OpenAI SDK by pointing `baseURL` at it:

```js
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:3000/v1', apiKey: 'not-needed' });

const stream = await client.chat.completions.create({
  model: 'auto',
  stream: true,
  messages: [{ role: 'user', content: 'Hi' }],
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
```

Notes:
- `stream: false` returns a single JSON completion (with `usage`).
- `role: "system"` is mapped to ChatGPT's `developer` role.
- Reasoning tokens stream as `delta.reasoning_content`.
- The resolved model echoes through the chunks as it streams.

## Programmatic usage

```bash
npm install chatgpt-anon-api
```

```js
import { chat, streamChat } from 'chatgpt-anon-api';

// one-shot
const r = await chat([{ role: 'user', content: 'Say hello' }]);
console.log(r.content, '|', r.model);

// streaming
for await (const c of streamChat([{ role: 'user', content: 'Tell me a joke' }])) {
  if (c.delta?.content) process.stdout.write(c.delta.content);
}
```

Options: `{ model, stream, anonBase, deviceId }`.

## CLI

```text
chatgpt-anon serve [--port 3000] [--base URL]    start the HTTP server
chatgpt-anon chat "message" [--stream]           one-shot chat, no server
chatgpt-anon health [--base http://localhost:3000]
```

Environment: `PORT`, `ANON_BASE` (upstream host, default `https://android.chat.openai.com`).

## How it works

1. Build a spoofed device-fingerprint config and generate the device token `p` (`gAAAAAC…`).
2. `POST /backend-anon/sentinel/chat-requirements` → sentinel `token`, proof-of-work
   challenge, and the encrypted turnstile bytecode (`turnstile.dx`).
3. Solve the PoW (FNV-1a 32 + avalanche mix, lexicographic difficulty check) → `gAAAAAB…~S`.
4. Decrypt `dx` with `p`, decompile the proprietary bytecode VM, rebuild the
   **turnstile token** from the fingerprint keys it requests.
5. `POST /f/conversation/prepare` → `conduit_token`.
6. `POST /f/conversation` with all three sentinel tokens → real-time SSE deltas,
   re-encapsulated into OpenAI `chat.completion.chunk` format.

## Honest caveats

- **Rate limits:** free and unlimited at the protocol level — no keys, no quota
  — but OpenAI throttles the anonymous backend per IP after a handful of
  requests (`403 "Unusual activity…"`). The 403 is surfaced as an HTTP `429` with
  a friendly message. Wait a few minutes, switch IP / use a proxy, or load-balance
  across several IPs.
- The turnstile payload embeds your public IP + geo (fetched from `ipwho.is`).
- Unofficial endpoint — OpenAI can change or shut it down at any time.
- Educational/research use only. Check local law and OpenAI's terms.

## Development

```bash
npm ci
npm run build   # src/ -> dist/
npm test        # offline Vitest suite (43 tests)
npm run lint
npm run typecheck
npm run e2e     # optional live smoke test against the real backend
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — © Jr Busaco (itsmejrb1)
