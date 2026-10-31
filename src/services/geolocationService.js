export function getCurrentLocation({
  geolocation = globalThis.navigator?.geolocation,
  secure = globalThis.isSecureContext,
  timeout = 10000,
} = {}) {
  if (!secure) return Promise.reject(new Error('現在地の取得にはHTTPS（開発時はlocalhost）が必要です。同じ端末のlocalhost、またはHTTPSで開いてください。'));
  if (!geolocation) return Promise.reject(new Error('このブラウザは位置情報に対応していません。地図を動かして地点を登録できます。'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      action(value);
    };
    const fail = (error) => {
      const message = {
        1: '位置情報が許可されていません。ブラウザの位置情報設定を確認してください。地点の登録は引き続き利用できます。',
        2: '現在地を取得できませんでした。電波や端末の位置情報設定を確認して、もう一度試してください。',
        3: '現在地の取得がタイムアウトしました。場所を変えるか、もう一度試してください。',
      }[error?.code] || '現在地を取得できませんでした。もう一度試してください。';
      finish(reject, new Error(message));
    };
    // 許可ダイアログを含めて待機を打ち切り、遅れて届いた結果は無視する。
    const timer = globalThis.setTimeout(() => fail({ code: 3 }), timeout);
    try {
      geolocation.getCurrentPosition((position) => {
        const { latitude, longitude, accuracy } = position?.coords || {};
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
          || !Number.isFinite(longitude) || Math.abs(longitude) > 180
          || !Number.isFinite(accuracy) || accuracy < 0) {
          finish(reject, new Error('現在地の取得結果が正しくありません。もう一度試してください。'));
          return;
        }
        finish(resolve, { latitude, longitude, accuracy });
      }, fail, { enableHighAccuracy: true, timeout, maximumAge: 0 });
    } catch (error) { fail(error); }
  });
}
