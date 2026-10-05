import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startGateway } from './gateway.mjs';
import { createInbox } from './inbox.mjs';
import { createChatbot, askCodex, serviceStateDirectory, codexWorkspace } from './chatbot.mjs';

function createDiscordRequest(env, fetchApi) {
  return async function request(body, endpoint = 'messages') {
    const token = env.DISCORD_BOT_TOKEN?.trim();
    const channel = env.DISCORD_CHANNEL_ID?.trim();
    if (!token || /\s/.test(token)) throw new Error('DISCORD_BOT_TOKEN을 설정하세요.');
    if (!/^\d{17,20}$/.test(channel ?? '')) throw new Error('DISCORD_CHANNEL_ID에 채널 ID를 설정하세요.');
    const response = await fetchApi(`https://discord.com/api/v10/channels/${channel}/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const hint = response.status === 429
        ? `요청 제한. Retry-After: ${response.headers.get('retry-after') ?? '확인 필요'}`
        : '토큰, 봇의 채널 접근 권한 및 채널 ID를 확인하세요.';
      throw new Error(`Discord HTTP ${response.status}: ${hint}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

export function createServer(env = process.env, fetchApi = fetch, inbox = createInbox()) {
  const server = new McpServer({ name: 'discord-feedback', version: '0.1.0' });
  const request = createDiscordRequest(env, fetchApi);

  async function result(action) {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await action()) }] };
    } catch (error) {
      // Never return credentials or Discord response bodies in tool errors.
      const message = error instanceof Error ? error.message : 'Discord 요청 실패';
      return { isError: true, content: [{ type: 'text', text: message.replaceAll(env.DISCORD_BOT_TOKEN || '\0', '[redacted]') }] };
    }
  }

  server.registerTool('discord_send_message', {
    description: '설정된 Discord 채널에 메시지를 전송합니다. 사용자에게 전송을 요청받은 경우에만 사용하세요. 멘션 알림은 비활성화됩니다.',
    inputSchema: { content: z.string().trim().min(1).max(2000), reply_to: z.string().regex(/^\d{17,20}$/).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, ({ content, reply_to }) => result(() => request({
    content, allowed_mentions: { parse: [], replied_user: false },
    ...(reply_to ? { message_reference: { message_id: reply_to, fail_if_not_exists: false } } : {}),
  })));
  server.registerTool('discord_send_typing', {
    description: '설정된 Discord 채널에 입력 중 표시를 보냅니다. 응답을 기다리는 동안 주기적으로 호출하세요.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, () => result(() => request(undefined, 'typing')));
  server.registerTool('discord_wait_message', {
    description: 'Gateway로 감지한 새 Discord 메시지 한 개를 수신합니다. 비어 있으면 최대 25초 대기 후 null을 반환합니다. 사용자가 Discord 수신 처리를 요청했을 때 호출하고, 결과는 discord_send_message의 reply_to에 메시지 ID를 넣어 답장하세요. 자동으로 CLI 턴을 시작하지 않습니다.',
    inputSchema: { timeout_ms: z.number().int().min(0).max(25000).default(25000) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, ({ timeout_ms }) => result(() => inbox.next(timeout_ms)));
  return server;
}

export async function startServer({ env = process.env, fetchApi = fetch,
  transport = new StdioServerTransport(), gatewayClient, ask = askCodex } = {}) {
  const inbox = createInbox({ dropOldest: true });
  const botInbox = createInbox();
  const controller = new AbortController();
  const request = createDiscordRequest(env, fetchApi);
  const server = createServer(env, fetchApi, inbox);
  await server.connect(transport);
  const gateway = startGateway(env, gatewayClient, console.error, message => {
    botInbox.push(message);
    inbox.push(message);
  });
  const receive = createChatbot({
    next: timeout => botInbox.next(timeout),
    typing: () => request(undefined, 'typing'),
    send: (content, id) => request({ content, allowed_mentions: { parse: [], replied_user: false },
      message_reference: { message_id: id, fail_if_not_exists: false } }),
  }, (content, session, signal, options) => ask(content, session, signal, {
    ...options, env, cwd: codexWorkspace(env),
  }), controller.signal, {
    sessionPath: resolve(serviceStateDirectory(env), 'session.json'),
    workspace: codexWorkspace(env),
    workflowPlugin: env.DISCORD_WORKFLOW_PLUGIN || 'namuk-process@namuk-marketplace',
    channelId: env.DISCORD_CHANNEL_ID || '',
  });
  const done = (async () => {
    while (!controller.signal.aborted) {
      try { await receive(); }
      catch (error) {
        if (!controller.signal.aborted) console.error(error.message.replaceAll(env.DISCORD_BOT_TOKEN || '\0', '[redacted]'));
      }
    }
  })();
  let closing;
  const shutdown = () => {
    if (controller.signal.aborted) return closing;
    controller.abort();
    inbox.close();
    botInbox.close();
    closing = (async () => {
      try { await gateway.destroy(); }
      finally { await server.close(); }
      await done;
    })();
    return closing;
  };
  server.server.onclose = () => { void shutdown(); };
  return { shutdown, done };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const envPath = fileURLToPath(new URL('.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const { shutdown } = await startServer();
  const stop = () => { void shutdown().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.stdin.once('end', stop);
  process.stdin.once('close', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
