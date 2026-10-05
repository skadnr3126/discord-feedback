import { spawnCodex, terminateCodex, loginCodex } from './codex-login.mjs';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function codexWorkspace(env = process.env) {
  return resolve(env.DISCORD_WORKSPACE_DIR || process.cwd());
}

export function serviceStateDirectory(env = process.env) {
  const key = createHash('sha256').update(codexWorkspace(env)).digest('hex').slice(0, 12);
  return resolve(env.DISCORD_SERVICE_STATE_DIR || join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'discord-feedback', key));
}

function cliFailure(details, code) {
  if (/access[_ ]token|refresh.*token|sign in again|401|unauthorized|logged out|not logged in|authentication required/i.test(details)) {
    return Object.assign(new Error('Codex 인증이 유효하지 않아. 봇 전용 Codex 로그인이 필요해.'), { code: 'CODEX_AUTH_REQUIRED' });
  }
  if (/usage limit|quota|rate limit|429/i.test(details)) {
    return new Error('Codex 사용 한도 또는 요청 제한에 도달했어.');
  }
  if (/loading config|invalid transport|unknown feature|unrecognized|invalid.*config/i.test(details)) {
    return new Error('Codex 또는 플러그인 실행 설정을 확인해야 해.');
  }
  return new Error(`Codex 작업 실행 실패 (종료 코드 ${code}). 변경된 파일이 남아 있을 수 있어.`);
}

export async function askCodex(message, session = {}, signal, options = {}) {
  signal?.throwIfAborted();
  if (session.id && !uuid.test(session.id)) throw new Error('잘못된 CLI 세션 ID');
  const sourceEnv = options.env || process.env;
  const cwd = options.cwd || codexWorkspace(sourceEnv);
  const timeoutMs = Number(options.timeoutMs ?? sourceEnv.DISCORD_CODEX_TIMEOUT_MS ?? 1800000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3600000) {
    throw new Error('DISCORD_CODEX_TIMEOUT_MS는 1~3600000 범위의 정수여야 해.');
  }
  const args = ['exec', ...(session.id ? ['resume', session.id] : []),
    '--json', '-c', `sandbox_mode=${options.readOnly ? 'read-only' : 'workspace-write'}`, '-c', 'approval_policy=never',
    '-c', 'sandbox_workspace_write.network_access=true', '-c', 'web_search=disabled',
    '-c', 'mcp_servers.discord.command="node"', '-c', 'mcp_servers.discord.args=[]',
    '-c', 'mcp_servers.discord.enabled=false'];
  for (const feature of ['plugins', 'shell_tool', 'unified_exec', 'multi_agent', 'code_mode_host']) {
    args.push('--enable', feature);
  }
  for (const feature of ['apps', 'remote_plugin',
    'browser_use', 'computer_use', 'image_generation', 'memories']) {
    args.push('--disable', feature);
  }
  args.push('-');
  const env = { ...sourceEnv,
    CODEX_HOME: sourceEnv.DISCORD_CODEX_HOME || join(serviceStateDirectory(sourceEnv), 'codex-home'),
    CODEX_SQLITE_HOME: sourceEnv.CODEX_SQLITE_HOME || join(serviceStateDirectory(sourceEnv), 'codex-state'),
  };
  for (const key of Object.keys(env)) if (key.startsWith('DISCORD_')) delete env[key];
  let reply = '';
  let failureDetails = '';
  let failedEvent = false;
  signal?.throwIfAborted();
  const authenticated = await new Promise((resolveRun, reject) => {
    const child = spawnCodex(args, cwd, env);
    const terminate = () => terminateCodex(child);
    const abort = () => { terminate(); };
    signal?.addEventListener('abort', abort, { once: true });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && uuid.test(event.thread_id ?? '')) session.id = event.thread_id;
        if (event.type === 'item.completed' && event.item?.type === 'agent_message'
          && typeof event.item.text === 'string') reply = event.item.text.trim();
        if (event.type === 'error' || event.type === 'turn.failed') {
          failedEvent = true;
          failureDetails = String(event.message || event.error?.message || '').slice(-16384);
        }
      } catch { /* CLI diagnostics are not conversation output. */ }
    });
    child.stderr.on('data', data => {
      // Classify errors in memory; never forward raw stderr or credential values.
      failureDetails = (failureDetails + data.toString()).slice(-16384);
    });
    const timer = setTimeout(() => {
      terminate();
      reject(new Error('Codex 작업 시간이 초과됐어. 변경된 파일이 남아 있을 수 있어.'));
    }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Codex 실행 실패. CLI 설치를 확인하세요.')); });
    child.once('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      lines.close();
      if (signal?.aborted) reject(new Error('CLI 실행 취소'));
      else code === 0 && !failedEvent ? resolveRun() : reject(cliFailure(failureDetails, code));
    });
    child.stdin.on('error', () => {});
    child.stdin.end([
      'Discord 사용자의 요청에 한국어로 답하세요.',
      '피드백 반영, 설계, 구현, 코드 수정 요청에는 설치된 namuk-process 플러그인의 development-workflow 스킬을 읽고 적용하세요.',
      '필요한 플러그인 스킬을 찾거나 읽을 수 없으면 이유를 보고하고 구현은 진행하지 마세요.',
      '설계와 구현에는 codebase-design 스킬을 적용하고 완료 기준과 실제 검증 결과를 대조하세요.',
      '현재 작업 디렉터리의 프로젝트가 작업 대상입니다. 사용자가 설명만 요청하면 설명만 하세요.',
      '충분한 정보가 있으면 요청 범위의 코드 수정과 테스트를 끝까지 수행하세요.',
      '사용자 결정이 꼭 필요하면 질문과 필요한 정보를 최종 답변에 적으세요. 다음 Discord 메시지로 대화가 이어집니다.',
      '변경 내용, 검증 결과, 미확인 항목을 보고하고 실행하지 않은 작업을 완료했다고 말하지 마세요.',
      'Git push, PR 제출, 배포 등 외부 반영은 사용자가 그 작업을 요청한 경우에만 수행하세요.',
      'Discord 메시지 전송은 브리지가 담당합니다. 별도의 Discord 봇을 실행하거나 Discord MCP를 호출하지 마세요.',
    ].join(' ') + '\n' + JSON.stringify({ content: message, context: options.context }));
  }).catch(async error => {
    if (error.code !== 'CODEX_AUTH_REQUIRED' || !options.onAuthMessage || signal?.aborted) throw error;
    await options.onAuthMessage('Codex 인증이 만료됐어. 재인증 링크와 코드를 준비하고 있어.');
    await loginCodex({ cwd, env, signal, timeoutMs: options.loginTimeoutMs,
      onPrompt: ({ url, code }) => options.onAuthMessage(
        `봇 전용 Codex 재인증이 필요해. 아래 링크에서 로그인하고 인증 코드를 입력해줘.\n${url}\n인증 코드: ${code}\n코드는 15분 동안 유효해. 인증이 끝나면 결과를 알려줄게.`),
    });
    return true;
  });
  if (authenticated) return 'Codex 인증이 완료됐어. 작업을 이어가려면 원래 요청을 다시 보내줘.';
  if (!reply) throw new Error('AI 응답이 비어 있습니다.');
  if (!session.id) throw new Error('CLI 세션 ID를 받지 못했습니다.');
  return reply;
}

export function createChatbot(discord, ask = askCodex, signal, {
  sessionPath, workspace = codexWorkspace(),
  workflowPlugin = process.env.DISCORD_WORKFLOW_PLUGIN || 'namuk-process@discord-feedback-workflows',
  channelId = process.env.DISCORD_CHANNEL_ID || '',
} = {}) {
  const session = {};
  if (sessionPath) {
    try {
      const saved = JSON.parse(readFileSync(sessionPath, 'utf8'));
      if (saved.workspace === workspace && saved.plugin === workflowPlugin && saved.channelId === channelId && uuid.test(saved.id || '')) {
        session.id = saved.id;
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  return async function receive() {
    const message = await discord.next(25000);
    if (!message || signal?.aborted) return;
    console.error(`Discord 수신: ${message.id} → CLI`);
    let typingPending = false;
    const sendTyping = async () => {
      if (typingPending || signal?.aborted) return;
      typingPending = true;
      try { await discord.typing(); }
      catch (error) { console.error(`Discord 입력 중 표시 실패: ${error.message}`); }
      finally { typingPending = false; }
    };
    await sendTyping();
    const typingTimer = setInterval(sendTyping, 8000);
    let reply;
    try {
      reply = await ask(message.content, session, signal, {
        context: { messageId: message.id, channelId: message.channelId, authorId: message.authorId },
        onAuthMessage: content => discord.send(content, message.id),
      });
    } catch (error) {
      if (!signal?.aborted) await discord.send(`작업을 완료하지 못했어. ${error.message}`, message.id);
      throw error;
    } finally {
      clearInterval(typingTimer);
      if (sessionPath && uuid.test(session.id || '')) {
        mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
        writeFileSync(`${sessionPath}.tmp`, JSON.stringify({ id: session.id, workspace, plugin: workflowPlugin, channelId }), { mode: 0o600 });
        renameSync(`${sessionPath}.tmp`, sessionPath);
      }
    }
    // No automatic POST retry: a timeout may mean the reply was already delivered.
    for (let start = 0; start < reply.length;) {
      let end = Math.min(start + 1900, reply.length);
      if (end < reply.length && /[\uD800-\uDBFF]/.test(reply[end - 1])) end--;
      if (signal?.aborted) return;
      await discord.send(reply.slice(start, end), message.id);
      start = end;
    }
    console.error(`CLI ${session.id} → Discord 답장: ${message.id}`);
  };
}
