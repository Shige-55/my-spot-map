export class AccessError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export function createApi({ base = '/', fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  return async function api(path, { method = 'GET', body, signal, keepalive = false } = {}) {
    let response;
    try {
      response = await fetcher(`${base}api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
        redirect: 'manual', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal, keepalive });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new AccessError('通信できません。接続を確認してください。');
    }
    if (response.type === 'opaqueredirect' || response.status === 0 || !response.headers.get('Content-Type')?.includes('application/json')) {
      throw new AccessError('本人確認が必要です。オンラインで確認し直してください。', 401);
    }
    let value;
    try { value = await response.json(); } catch { throw new AccessError('応答を確認できません。管理者へ確認してください。', 502); }
    if (!response.ok) throw new AccessError(typeof value.message === 'string' ? value.message : '処理できませんでした。', response.status);
    return value;
  };
}
