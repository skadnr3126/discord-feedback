import { fileURLToPath } from 'node:url';
import { runRuntime } from '../runtime.mjs';
await runRuntime({
  serverPath: fileURLToPath(new URL('./fake-server.mjs', import.meta.url)),
  readyTimeoutMs: process.env.RUNTIME_FIXTURE_MODE === 'no-ready' ? 1500 : 5000,
  pingIntervalMs: 100,
  pingTimeoutMs: 200,
});
