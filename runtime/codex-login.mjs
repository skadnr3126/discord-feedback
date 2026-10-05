import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

export function spawnCodex(args, cwd, env) {
  // Arguments are fixed by the bridge; user messages only reach stdin.
  return process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `codex.cmd ${args.join(' ')}`],
      { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('codex', args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function terminateCodex(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
  }
}

export async function loginCodex({ cwd, env, signal, onPrompt, timeoutMs = 900000 }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnCodex(['login', '--device-auth'], cwd, env);
    let output = '';
    let prompt;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error && child.pid && child.exitCode === null && child.signalCode === null) {
        child.once('close', () => reject(error));
        terminateCodex(child);
      } else if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Codex 인증을 취소했어.'));
    const timer = setTimeout(() => finish(new Error('Codex 인증 시간이 초과됐어. 요청을 다시 보내면 새 인증 코드를 받을 수 있어.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const read = data => {
      if (settled || prompt) return;
      output = (output + data).slice(-16384);
      const clean = stripVTControlCharacters(output);
      const url = clean.match(/https:\/\/auth\.openai\.com\/codex\/device(?=\s|$)/)?.[0];
      const code = clean.match(/one-time code[^\r\n]*\r?\n[ \t]*([A-Z0-9]+(?:-[A-Z0-9]+)*)[ \t]*\r?\n/)?.[1];
      // Wait for a complete code line so split stream chunks cannot truncate it.
      if (!url || !code) return;
      prompt = Promise.resolve().then(() => onPrompt({ url, code }));
      prompt.catch(() => finish(new Error('Codex 인증 안내를 전달하지 못했어. 요청을 다시 보내줘.')));
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', () => finish(new Error('Codex 인증 실행에 실패했어. CLI 설치를 확인해줘.')));
    child.once('close', async code => {
      if (settled) return;
      if (code !== 0 || !prompt) {
        finish(new Error('Codex 재인증에 실패했어. ChatGPT 보안 설정에서 디바이스 코드 로그인을 허용했는지 확인하고 요청을 다시 보내줘. 계속 실패하면 봇 전용 login 명령으로 인증해줘.'));
        return;
      }
      try { await prompt; finish(); }
      catch { /* Prompt delivery failure has already stopped the login. */ }
    });
    child.stdin.on('error', () => {});
    child.stdin.end();
    if (signal?.aborted) abort();
  });
}
