import { importJWK, SignJWT } from 'jose';
import { HttpError } from './auth.js';

export async function issuePermit(env, member, device, now) {
  if (typeof device !== 'string' || !/^[a-f0-9-]{36}$/.test(device)) throw new HttpError(400, '端末の識別情報が正しくありません。');
  const jwk = JSON.parse(env.OFFLINE_PRIVATE_JWK);
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new HttpError(503, 'オフライン利用の署名設定が正しくありません。');
  const key = await importJWK(jwk, 'ES256');
  const iat = Math.floor(now / 1000);
  const token = await new SignJWT({ kind: 'offline-local-only', device, role: member.role, name: member.name, version: member.version })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' }).setSubject(member.id)
    .setIssuer('my-spot-map').setAudience(new URL(env.APP_ORIGIN).origin).setIssuedAt(iat).setExpirationTime(iat + 86400).sign(key);
  return { token, expiresAt: (iat + 86400) * 1000, serverNow: now };
}
