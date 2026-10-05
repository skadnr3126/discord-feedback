import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const toolRoot = fileURLToPath(new URL('../', import.meta.url));

export async function runRuntime({
  serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url)),
  readyTimeoutMs = 60000,
  pingIntervalMs = 30000,
  pingTimeoutMs = 10000,
} = {}) {
  function log(message) { console.log(`${new Date().toISOString()} ${message}`); }
  for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID']) {
    if (!process.env[name]?.trim()) { log(`Missing runtime variable: ${name}`); process.exit(1); }
  }
  const client = new Client({ name: 'cloud-discord-runtime', version: '1.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--use-env-proxy', '--require', fileURLToPath(new URL('./proxy.cjs', import.meta.url)), serverPath],
    env: process.env,
    stderr: 'pipe',
  });
  let stopping = false;
  let pending = '';
  let healthTimer;
  let readyTimer;
  let pingPending = false;

  async function stop(reason, exitCode) {
    if (stopping) return;
    stopping = true;
    clearInterval(healthTimer);
    clearTimeout(readyTimer);
    log(`Stopping: ${reason}; exit=${exitCode}`);
    const forced = setTimeout(() => process.exit(exitCode), 5000);
    try { await client.close(); } catch { /* Transport may already be closed. */ }
    clearTimeout(forced);
    process.exit(exitCode);
  }
  process.once('SIGINT', () => void stop('SIGINT received', 0));
  process.once('SIGTERM', () => void stop('SIGTERM received', 0));
  process.once('uncaughtException', () => void stop('uncaught exception', 1));
  process.once('unhandledRejection', () => void stop('unhandled rejection', 1));
  client.onclose = () => { if (!stopping) void stop('MCP transport closed unexpectedly', 1); };
  client.onerror = () => { if (!stopping) log('MCP protocol error'); };

  // Only operational events; never message content or credential values.
  transport.stderr?.on('data', chunk => {
    pending = (pending + chunk.toString()).slice(-65536);
    for (;;) {
      const i = pending.indexOf('\n');
      if (i < 0) break;
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      if (line.includes('Discord Gateway 연결 완료')) {
        clearTimeout(readyTimer);
        log('Discord Gateway READY: bot online');
      } else if (line.includes('Discord Gateway 로그인 실패') || line.includes('DISCORD_BOT_TOKEN을 설정하세요')) {
        void stop('Discord Gateway authentication failed', 1);
      } else if (line.includes('Discord Gateway 연결 오류')) {
        log('Discord Gateway connection error; library reconnect active');
      } else if (line.startsWith('Discord 수신:')) {
        log('Received user Discord message');
      } else if (line.startsWith('CLI ') && line.includes('Discord 답장:')) {
        log('CLI response delivered to Discord');
      } else if (line.startsWith('Codex 작업 실행 실패')) {
        const code = line.match(/종료 코드 (\d+)/)?.[1] ?? 'unknown';
        log(`Codex reply failed: exit=${code}`);
      } else if (line.includes('Codex 인증이 유효하지 않아')) {
        log('Codex authentication failed; bot CLI login required');
      } else if (line.includes('Codex 작업 시간이 초과')) {
        log('Codex reply timed out');
      }
    }
  });

  try {
    readyTimer = setTimeout(() => void stop('Gateway READY timeout', 1), readyTimeoutMs);
    await client.connect(transport, { timeout: 15000 });
    const { tools } = await client.listTools({}, { timeout: 15000 });
    const names = tools.map(tool => tool.name);
    for (const expected of ['discord_send_message', 'discord_send_typing', 'discord_wait_message']) {
      if (!names.includes(expected)) throw new Error('Missing expected MCP tool');
    }
    log(`MCP initialized; server PID=${transport.pid}; tools verified`);
    healthTimer = setInterval(async () => {
      if (stopping || pingPending) return;
      pingPending = true;
      try { await client.ping({ timeout: pingTimeoutMs }); }
      catch { void stop('MCP health ping failed', 1); }
      finally { pingPending = false; }
    }, pingIntervalMs);
  } catch { void stop('MCP startup failed', 1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envPath = resolve(toolRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  await runRuntime();
}
