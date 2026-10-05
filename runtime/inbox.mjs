export function createInbox({ dropOldest = false } = {}) {
  const messages = [];
  let waiter;
  return {
    push(message) {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(message);
      } else {
        // ponytail: keep 100 pending messages in memory; persist if restart recovery is needed.
        if (messages.length === 100) {
          if (!dropOldest) throw new Error('Discord 수신함이 가득 찼습니다. 수신 도구로 메시지를 처리하세요.');
          messages.shift();
        }
        messages.push(message);
      }
    },
    next(timeoutMs) {
      if (messages.length) return Promise.resolve(messages.shift());
      if (waiter) throw new Error('이미 메시지 수신을 대기 중입니다.');
      return new Promise(resolve => {
        const timer = setTimeout(() => { waiter = undefined; resolve(null); }, timeoutMs);
        waiter = message => { clearTimeout(timer); resolve(message); };
      });
    },
    close() {
      const resolve = waiter;
      waiter = undefined;
      resolve?.(null);
    },
  };
}
