# Contributing

Thanks for helping with `chatgpt-anon-api`!

## Setup

```bash
git clone https://github.com/itsmejrb1/chatgpt-anon-api.git
cd chatgpt-anon-api
npm ci
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Compile `src/` → `dist/` (tsc, NodeNext ESM) |
| `npm run typecheck` | `tsc --noEmit` over `src/` |
| `npm run lint` | ESLint (flat config, typescript-eslint) |
| `npm run format` | Prettier auto-format |
| `npm test` | Vitest unit tests (no network) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with coverage |
| `npm run e2e` | Live smoke test against the real anonymous API |

All of the above must pass before a PR is merged (CI enforces this on Node 18/20/22).

## Project layout

```
src/
  challenges.ts   device token + proof-of-work solver
  decompiler.ts   turnstile bytecode VM -> JS decompiler
  parser.ts       static analysis of the decompiled JS
  vm.ts           turnstile token builder (fingerprint payload)
  handshake.ts    sentinel handshake + conversation plumbing
  openai.ts       SSE -> OpenAI chat.completion.chunk
  client.ts       programmatic chat()/streamChat()
  server.ts       OpenAI-compatible HTTP server
  bin/cli.ts      CLI (serve / chat / health)
test/             Vitest suite (all offline, no API keys)
scripts/e2e.mjs   optional live smoke test
```

## Testing notes

- Unit tests never touch the network. HTTP is injected via `vi.stubGlobal('fetch', …)`
  and the turnstile bytecode is faked with `vi.mock`.
- `npm run e2e` does hit the real anon backend and can be rate-limited; it is not
  part of CI. If you get a `403 Unusual activity`, wait a bit and retry.

## Attribution

This project reverse-engineers the ChatGPT Android app's anonymous device-proof
challenge (proof-of-work + turnstile) and is cross-checked against
[realasfngl/ChatGPT](https://github.com/realasfngl/ChatGPT). Keep credit for the
reconstruction method whenever you borrow or adapt the internals.

## License

MIT — see `LICENSE`.