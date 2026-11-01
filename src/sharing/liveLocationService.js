export function createLiveLocationService({ api, geolocation = globalThis.navigator?.geolocation,
  isVisible = () => globalThis.document.visibilityState === 'visible',
  isOnline = () => globalThis.navigator.onLine, onChange = () => {},
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout, monotonic = () => globalThis.performance.now() }) {
  let generation = 0, session = null, timer = null, expiry = null, position = null, eligible = false, acquiring = false;
  let state = { status: 'off', positions: [] };
  const emit = (value) => { state = value; onChange(state); };
  const stop = async (text = '現在地の共有は停止中です。') => {
    generation++; cancel(timer); cancel(expiry); position = null; eligible = false; acquiring = false;
    const cycle = generation;
    const old = session; session = null; emit({ status: 'off', positions: [], message: text });
    if (old) try { await api('live/stop', { method: 'POST', body: { sessionId: old }, keepalive: true }); }
    catch { if (cycle === generation) emit({ status: 'off', positions: [], message: 'この端末では停止しました。通知が届かなかった場合も、最後に受理された通知から15秒で相手の表示が失効します。' }); }
  };
  const acquire = (cycle) => {
    if (acquiring || !eligible || !geolocation || !isVisible() || !isOnline()) return;
    acquiring = true;
    geolocation.getCurrentPosition((value) => {
      if (cycle !== generation) return;
      acquiring = false;
      const age = Date.now() - value.timestamp;
      if (!isVisible() || !isOnline() || age < -5000 || age > 30000) return;
      position = { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy,
        ageMs: Math.max(0, age), at: monotonic() };
    }, () => { if (cycle === generation) { acquiring = false; void stop('位置情報を取得できません。共有を停止しました。権限と通信を確認してください。'); } },
    { maximumAge: 0, timeout: 7000, enableHighAccuracy: false });
  };
  const pulse = async (cycle) => {
    if (cycle !== generation || !session) return;
    if (!isVisible() || !isOnline()) { void stop(); return; }
    const started = monotonic();
    try {
      const sample = eligible && position ? { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy,
        ageMs: position.ageMs + Math.max(0, started - position.at) } : null;
      const result = await api('live/pulse', { method: 'POST', body: { sessionId: session, ...(sample && sample.ageMs <= 30000 ? { position: sample } : {}) },
        signal: globalThis.AbortSignal.timeout(7000) });
      if (cycle !== generation || !isVisible() || !isOnline()) return;
      const elapsed = monotonic() - started;
      if (elapsed >= 15000) throw new Error('現在地の応答が古くなりました。');
      eligible = result.eligibleCount > 0;
      if (!eligible) position = null;
      const positions = result.positions.filter((item) => item.expiresAt - result.serverNow > elapsed);
      emit({ status: eligible ? 'sharing' : 'waiting', positions,
        message: eligible ? '現在地を共有中です。アプリを閉じると停止します。' : '相手の共有開始を待っています。座標は送信していません。' });
      cancel(expiry);
      const ttl = Math.max(0, Math.min(15000, ...positions.map((p) => p.expiresAt - result.serverNow)) - elapsed);
      expiry = schedule(() => { if (cycle === generation) emit({ ...state, positions: [] }); }, ttl);
      acquire(cycle);
      timer = schedule(() => void pulse(cycle), Math.max(0, 5000 - elapsed));
    } catch (error) { if (cycle === generation) await stop(error.message); }
  };
  return {
    async start(recipients) {
      await stop();
      if (!isVisible() || !isOnline()) throw new Error('オンラインでアプリを表示してから開始してください。');
      if (!geolocation) throw new Error('このブラウザは位置情報に対応していません。');
      const cycle = ++generation;
      const result = await api('live/start', { method: 'POST', body: { recipients } });
      if (cycle !== generation || !isVisible() || !isOnline()) {
        void api('live/stop', { method: 'POST', body: { sessionId: result.sessionId }, keepalive: true }).catch(() => {}); return;
      }
      session = result.sessionId; await pulse(cycle);
    },
    stop,
    get state() { return state; },
  };
}
