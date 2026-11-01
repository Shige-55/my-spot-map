import { validatePermit } from './permit.js';

export function createAccessService({ repository, api, publicJwk, origin,
  now = () => Date.now(), monotonic = () => globalThis.performance.now() }) {
  let current = null;
  let device;
  let deadline = 0;
  let generation = 0;
  let lastToken = null;
  let writes = Promise.resolve();
  const write = (action) => { writes = writes.catch(() => {}).then(action); return writes; };
  const validate = async (record) => validatePermit(record, { publicJwk, origin, device, now: now() });
  const remember = async (record, online, cycle) => {
    const member = await validate(record);
    const nextDeadline = monotonic() + Math.max(0, member.expiresAt - now());
    if (!online && record.token === lastToken && monotonic() >= deadline) throw new Error('オフライン利用の期限が切れました。');
    return write(async () => {
      if (cycle !== generation) return current;
      await repository.save({ ...record, lastSeen: now() });
      if (cycle !== generation) return current;
      deadline = !online && lastToken === record.token ? Math.min(deadline, nextDeadline) : nextDeadline;
      lastToken = record.token;
      current = { ...member, online };
      return current;
    });
  };
  return {
    async check() {
      const cycle = ++generation;
      device ||= await repository.device();
      try {
        const result = await api('session', { method: 'POST', body: { device }, signal: globalThis.AbortSignal.timeout(10000) });
        if (cycle !== generation) return current;
        if (result.sessionId && result.sessionId === await repository.blockedSession?.()) throw new Error('ログアウト済みです。パスキーで再度ログインしてください。');
        const state = await remember({ token: result.permit.token, sessionId: result.sessionId, lastSeen: now() }, true, cycle);
        if (cycle !== generation) return current;
        if (state.id !== result.member?.id || state.role !== result.member?.role) throw new Error('利用許可を確認できません。');
        return state;
      } catch (error) {
        if (cycle !== generation) return current;
        // 認証拒否・不正応答・設定不備を「オフライン」と見なさない。
        if ((error.status && error.status !== 503) || (!error.status && error.name !== 'TimeoutError' && error.message !== '通信できません。接続を確認してください。')) {
          await write(() => repository.clear()); current = null; throw error;
        }
        try { return await remember(await repository.load(), false, cycle); }
        catch { current = null; throw new Error('オンラインで本人確認と招待の確認が必要です。個人地点は保持しています。'); }
      }
    },
    async inspectOffline() {
      device ||= await repository.device();
      if (current && monotonic() >= deadline) throw new Error('オフライン利用の期限が切れました。オンラインで確認してください。');
      return remember(await repository.load(), false, generation);
    },
    async logout() { generation++; current = null; await write(() => repository.blockSession ? repository.blockSession() : repository.clear()); },
    get current() { return current; },
  };
}
