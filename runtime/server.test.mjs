import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events } from 'discord.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from './server.mjs';

test('server entry exits when stdin ends and keeps logs out of MCP stdout', async () => {
  const url = new URL('./server.mjs', import.meta.url);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('DISCORD_')) delete env[key];
  // Disable local .env loading so this check never contacts Discord or Codex.
  const script = `process.loadEnvFile = () => {}; process.argv[1] = ${JSON.stringify(fileURLToPath(url))}; await import(${JSON.stringify(url.href)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('"id":1')) child.stdin.end();
  });
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    }) + '\n');
    assert.deepEqual(await exited, { code: 0, signal: null });
    const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].result.serverInfo.name, 'discord-feedback');
    assert.match(stderr, /DISCORD_BOT_TOKEN/);
  } finally { clearTimeout(timer); child.kill(); }
});

test('one server auto-replies, preserves MCP tools and aborts the bot when MCP closes', async t => {
  const state = await mkdtemp(join(tmpdir(), 'discord-server-'));
  t.mock.method(console, 'error', () => {});
  const gateway = new EventEmitter();
  gateway.login = async () => {};
  gateway.isReady = () => true;
  gateway.user = { id: '123456789012345677' };
  let destroyed = 0;
  gateway.destroy = async () => { destroyed++; };
  const posts = [];
  const sessions = [];
  let cancelled = false;
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const runtime = await startServer({
    env: { DISCORD_BOT_TOKEN: 'fake', DISCORD_CHANNEL_ID: '123456789012345678', DISCORD_SERVICE_STATE_DIR: state },
    gatewayClient: gateway, transport: b,
    fetchApi: async (url, options) => {
      if (url.endsWith('/typing')) return new Response(null, { status: 204 });
      posts.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: 'reply' }));
    },
    ask: async (content, session, signal) => {
      sessions.push(session);
      if (content !== 'pending') return `답변: ${content}`;
      started();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        cancelled = true;
        reject(new Error('cancelled'));
      }, { once: true }));
    },
  });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(a);
  const send = (id, content) => gateway.emit(Events.MessageCreate, {
    id, content: `<@123456789012345677> ${content}`, channelId: '123456789012345678', type: 0, author: { bot: false },
  });
  try {
    assert.equal((await client.listTools()).tools.length, 3);
    for (const [id, content] of [['123456789012345679', 'hello'], ['123456789012345680', 'again']]) {
      send(id, content);
      const result = await client.callTool({ name: 'discord_wait_message', arguments: { timeout_ms: 0 } });
      assert.deepEqual(JSON.parse(result.content[0].text), { id, content, channelId: '123456789012345678' });
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(sessions[0], sessions[1]);
    assert.deepEqual(posts.map(post => post.content), ['답변: hello', '답변: again']);
    assert.equal(posts[0].message_reference.message_id, '123456789012345679');
    assert.deepEqual(posts[0].allowed_mentions, { parse: [], replied_user: false });
    send('123456789012345681', 'pending');
    await pending;
    await client.close();
    await runtime.done;
    await runtime.shutdown();
    assert.equal(cancelled, true);
    assert.equal(destroyed, 1);
    assert.equal(posts.length, 2);
  } finally { await client.close(); await runtime.shutdown(); await rm(state, { recursive: true, force: true }); }
});
