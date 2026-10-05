import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const supported = process.platform !== 'win32' && process.allowedNodeEnvironmentFlags.has('--use-env-proxy');
const serviceOptions = { skip: supported ? false : 'Unix service requires Node environment-proxy support' };

function fixture(mode) {
  const env = { ...process.env, RUNTIME_FIXTURE_MODE: mode,
    DISCORD_BOT_TOKEN: 'test-secret-do-not-log', DISCORD_CHANNEL_ID: '123456789012345678' };
  const child = spawn(process.execPath, [fileURLToPath(new URL('./service/fixtures/run-runtime.mjs', import.meta.url))], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
  return { child, exited, get output() { return output; } };
}

for (const [mode, reason] of [
  ['crash', 'MCP transport closed unexpectedly'],
  ['hang-ping', 'MCP health ping failed'],
  ['no-ready', 'Gateway READY timeout'],
]) {
  test(`background runtime exits nonzero on ${mode} so Supervisor can restart it`, serviceOptions, async () => {
    const runtime = fixture(mode);
    const result = await runtime.exited;
    assert.equal(result.code, 1, result.output);
    assert.equal(result.signal, null, result.output);
    assert.match(result.output, new RegExp(reason));
    assert.doesNotMatch(result.output, /test-secret-do-not-log|confidential message/);
  });
}

test('runtime verifies tools, reaches READY, and exits cleanly on service stop', serviceOptions, async () => {
  const runtime = fixture('healthy');
  const deadline = Date.now() + 5000;
  try {
    while (!(runtime.output.includes('Discord Gateway READY') && runtime.output.includes('tools verified')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.match(runtime.output, /Discord Gateway READY/);
    assert.match(runtime.output, /tools verified/);
    runtime.child.kill('SIGTERM');
    const result = await runtime.exited;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /SIGTERM received/);
    assert.doesNotMatch(result.output, /test-secret-do-not-log|confidential message/);
  } finally { runtime.child.kill('SIGKILL'); }
});
