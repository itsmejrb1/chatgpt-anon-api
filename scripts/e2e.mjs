import { chat } from '../dist/index.js';

const message = process.argv[2] || 'what is love?';

try {
  const r = await chat([{ role: 'user', content: message }], { model: 'auto' });
  console.log(`model:   ${r.model}`);
  console.log(`finish:  ${r.finish_reason}`);
  console.log(`content: ${(r.content || '').slice(0, 200)}`);
  if (r.finish_reason !== 'stop' || !r.content) {
    console.error('E2E FAILED');
    process.exit(1);
  }
  console.log('E2E OK');
} catch (e) {
  console.error(`E2E FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}