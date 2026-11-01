import { importJWK, jwtVerify } from 'jose';

export async function validatePermit(record, { publicJwk, origin, device, now = Date.now() }) {
  if (!record?.token || !publicJwk || !device || !Number.isFinite(record.lastSeen) || now < record.lastSeen - 5000) throw new Error('利用許可の再確認が必要です。');
  const jwk = typeof publicJwk === 'string' ? JSON.parse(publicJwk) : publicJwk;
  if (jwk.d || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('利用許可の検証設定が正しくありません。');
  const key = await importJWK(jwk, 'ES256');
  const { payload } = await jwtVerify(record.token, key, { issuer: 'my-spot-map', audience: origin,
    algorithms: ['ES256'], currentDate: new Date(now), requiredClaims: ['sub', 'iat', 'exp'] });
  if (payload.kind !== 'offline-local-only' || payload.device !== device || payload.exp - payload.iat > 86400
    || payload.iat * 1000 > now + 5000 || !['owner', 'member'].includes(payload.role)) throw new Error('利用許可が正しくありません。');
  return { id: payload.sub, name: payload.name, role: payload.role, expiresAt: payload.exp * 1000 };
}
