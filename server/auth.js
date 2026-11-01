export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function checkWriteOrigin(request) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  if (request.headers.get('Origin') !== new URL(request.url).origin
    || !['same-origin', null].includes(request.headers.get('Sec-Fetch-Site'))) {
    throw new HttpError(403, 'この画面以外からの操作は受け付けられません。');
  }
}

export async function readBody(request, maxBytes = 16000) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON形式で送信してください。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '送信内容がありません。');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, '送信内容が大きすぎます。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '送信内容を読み取れません。');
  }
}
