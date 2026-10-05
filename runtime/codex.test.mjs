import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { askCodex, createChatbot } from './chatbot.mjs';

const unix = { skip: process.platform === 'win32' };
const id = '11111111-2222-3333-4444-555555555555';

async function fakeCli(mode = 'reply') {
  const directory = await mkdtemp(join(tmpdir(), 'discord-cli-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  if (process.platform === 'win32') {
    await writeFile(join(bin, 'codex.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0codex" %*\r\n`);
  }
  await writeFile(join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
if (process.argv[2] === 'login') {
  fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({args:process.argv.slice(2),
    home:process.env.CODEX_HOME,discordToken:process.env.DISCORD_BOT_TOKEN}) + '\\n');
  if (process.env.FAKE_LOGIN_MODE === 'fail') {
    console.error('sensitive-login-secret'); process.exitCode = 1; return;
  }
  const stream = process.env.FAKE_LOGIN_MODE === 'stderr' ? process.stderr : process.stdout;
  stream.write('https://auth.openai.com/codex/device\\n2. Enter this one-time code (expires in 15 minutes)\\n   \\x1b[94mABCD-');
  setTimeout(() => stream.write('1234\\x1b[0m\\n'), 25);
  const poll = setInterval(() => {
    if (fs.existsSync(process.env.FAKE_LOGIN_DONE)) { clearInterval(poll); process.exitCode = 0; }
  }, 20);
  return;
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => input += part);
process.stdin.on('end', () => {
  const payload = JSON.parse(input.slice(input.indexOf('\\n') + 1));
  fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({args:process.argv.slice(2),payload,
    cwd:process.cwd(),home:process.env.CODEX_HOME,discordToken:process.env.DISCORD_BOT_TOKEN}) + '\\n');
  if (process.env.FAKE_CLI_MODE.startsWith('auth')) {
    console.error('sensitive-value-that-must-not-be-forwarded');
    console.log(JSON.stringify({type:'turn.failed',error:{message:'Your access token could not be refreshed; sign in again.'}}));
    process.exitCode = process.env.FAKE_CLI_MODE === 'auth-zero' ? 0 : 1;
  } else if (process.env.FAKE_CLI_MODE === 'hang') {
    spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "orphan"), 1000)', process.env.FAKE_CLI_ORPHAN], {stdio:'ignore'});
    setInterval(() => {}, 1000);
  } else {
    console.log('non-JSON diagnostic');
    console.log(JSON.stringify({type:'thread.started',thread_id:'${id}'}));
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'progress'}}));
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:payload.content}}));
  }
});
`, { mode: 0o700 });
  return { directory, env: { ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    DISCORD_BOT_TOKEN: 'do-not-pass', DISCORD_WORKSPACE_DIR: directory,
    DISCORD_CODEX_HOME: join(directory, 'codex-home'),
    FAKE_CLI_LOG: join(directory, 'calls.jsonl'), FAKE_CLI_MODE: mode,
    FAKE_CLI_ORPHAN: join(directory, 'orphan.txt'),
    FAKE_LOGIN_DONE: join(directory, 'login-done'),
  } };
}

test('real CLI child uses stdin, hides Discord credentials and resumes with plugin permissions', unix, async () => {
  const fixture = await fakeCli();
  try {
    const session = {};
    const content = '한국어 & $(touch injected)';
    assert.equal(await askCodex(content, session, undefined, { env: fixture.env }), content);
    assert.equal(session.id, id);
    assert.equal(await askCodex('follow-up', session, undefined, { env: fixture.env }), 'follow-up');
    const calls = (await readFile(fixture.env.FAKE_CLI_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls[0].cwd, fixture.directory);
    assert.equal(calls[0].home, fixture.env.DISCORD_CODEX_HOME);
    assert.equal(calls[0].discordToken, undefined);
    assert.equal(calls[0].payload.content, content);
    assert.equal(calls[0].args.includes(content), false);
    assert.deepEqual(calls[1].args.slice(0, 3), ['exec', 'resume', id]);
    for (const call of calls) {
      assert.ok(call.args.includes('sandbox_mode=workspace-write'));
      assert.ok(call.args.includes('approval_policy=never'));
      assert.ok(call.args.includes('mcp_servers.discord.enabled=false'));
      assert.ok(call.args.includes('plugins'));
      assert.ok(call.args.includes('code_mode_host'));
      assert.equal(call.args.includes('--ignore-user-config'), false);
    }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

for (const mode of ['auth', 'auth-zero']) {
  test(`authentication recovery sends the full code and completion to the original Discord request (${mode})`, async () => {
    const fixture = await fakeCli(mode);
    if (mode === 'auth-zero') fixture.env.FAKE_LOGIN_MODE = 'stderr';
    const replies = [];
    const discord = { next: async () => ({ id: 'request', content: 'implement' }), typing: async () => {},
      send: async (content, replyTo) => {
        replies.push({ content, replyTo });
        if (content.includes('인증 코드:')) {
          assert.match(content, /인증 코드: ABCD-1234/);
          await writeFile(fixture.env.FAKE_LOGIN_DONE, 'authenticated');
        }
      },
    };
    try {
      const receive = createChatbot(discord, (message, session, signal, options) =>
        askCodex(message, session, signal, { ...options, env: fixture.env, loginTimeoutMs: 3000 }));
      await receive();
      assert.equal(replies.length, 3);
      assert.ok(replies.every(reply => reply.replyTo === 'request'));
      assert.match(replies[0].content, /준비하고/);
      assert.match(replies[1].content, /https:\/\/auth.openai.com\/codex\/device/);
      assert.match(replies[2].content, /인증이 완료/);
      assert.doesNotMatch(JSON.stringify(replies), /sensitive|\u001b/);
      const calls = (await readFile(fixture.env.FAKE_CLI_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].args, ['login', '--device-auth']);
      assert.equal(calls[1].home, fixture.env.DISCORD_CODEX_HOME);
      assert.equal(calls[1].discordToken, undefined);
      // A subsequent request can run after recovery without restarting the bot.
      fixture.env.FAKE_CLI_MODE = 'reply';
      await receive();
      assert.equal(replies.at(-1).content, 'implement');
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });
}

for (const mode of ['fail', 'timeout', 'abort', 'delivery']) {
  test(`authentication recovery handles ${mode} without leaking diagnostics`, async () => {
    const fixture = await fakeCli('auth');
    fixture.env.FAKE_LOGIN_MODE = mode;
    const controller = new AbortController();
    const replies = [];
    try {
      await assert.rejects(askCodex('implement', {}, controller.signal, {
        env: fixture.env, loginTimeoutMs: mode === 'timeout' ? 500 : 3000,
        onAuthMessage: async content => {
          replies.push(content);
          if (!content.includes('인증 코드:')) return;
          if (mode === 'abort') controller.abort();
          if (mode === 'delivery') throw new Error('sensitive-discord-secret');
        },
      }), error => {
        assert.match(error.message, mode === 'timeout' ? /시간이 초과/ : mode === 'abort' ? /취소/ : mode === 'delivery' ? /전달하지 못/ : /재인증에 실패/);
        assert.doesNotMatch(error.message, /sensitive/);
        return true;
      });
      assert.equal(replies.length, mode === 'fail' ? 1 : 2);
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });
}

test('authentication failures report a useful error without forwarding raw CLI diagnostics', unix, async () => {
  const fixture = await fakeCli('auth');
  try {
    await assert.rejects(askCodex('implement', {}, undefined, { env: fixture.env }), error => {
      assert.match(error.message, /인증/);
      assert.doesNotMatch(error.message, /sensitive-value/);
      return true;
    });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test('timeout stops the CLI process group so its child does not continue writing', unix, async () => {
  const fixture = await fakeCli('hang');
  try {
    await assert.rejects(askCodex('implement', {}, undefined, { env: fixture.env, timeoutMs: 500 }), /시간이 초과/);
    await delay(1200);
    await assert.rejects(access(fixture.env.FAKE_CLI_ORPHAN), { code: 'ENOENT' });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
