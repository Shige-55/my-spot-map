import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../helpers/sqliteD1.js';
import { createHandler } from '../../server/index.js';
import { HttpError } from '../../server/auth.js';
import { createPlaceSearchService } from '../../src/services/placeSearchService.js';

let db, env, time, fetchGeocoder;
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const found = [{ display_name: '<img src=x onerror=alert(1)> 架空の公共施設', lat: '35.6', lon: '139.7' }];
beforeEach(() => {
  db = sqliteD1(); time = Date.now();
  ids.forEach((id,i) => db.raw.prepare("INSERT INTO app_members(id,email,name,role,status,subject,created_at,updated_at) VALUES (?,?,'架空利用者',?,'active',?,?,?)")
    .run(id, `user${i}@example.test`, i ? 'member' : 'owner', 'passkey:'+id, time, time));
  env = { DB: db, APP_ORIGIN: 'https://app.example.test', SESSION_SECRET: 'a'.repeat(64), OFFLINE_PRIVATE_JWK: 'fixture',
    PLACE_SEARCH_ENABLED: 'true', PLACE_SEARCH_URL: 'https://geocoder.example.test/search', ASSETS: {} };
  fetchGeocoder = vi.fn(async () => Response.json(found));
});
afterEach(() => db.raw.close());
function call(query='架空の公園', actor=0, origin=env.APP_ORIGIN) {
  const handler = createHandler({ now:()=>time, fetchGeocoder, authenticate: async () => {
    if (actor === null) throw new HttpError(401,'本人確認してください。');
    return { email: `user${actor}@example.test`, subject: 'passkey:'+ids[actor] };
  } });
  return handler.fetch(new Request(env.APP_ORIGIN+'/api/place-search',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({query})}),env);
}
test('未認証・取消・CSRFと検索停止時は外部へ送信しない', async()=>{
  expect((await call('施設',null)).status).toBe(401);
  expect((await call('施設',0,'https://evil.example.test')).status).toBe(403);
  db.raw.prepare("UPDATE app_members SET status='revoked' WHERE id=?").run(ids[1]);
  expect((await call('施設',1)).status).toBe(403);
  env.PLACE_SEARCH_ENABLED='false';expect((await call()).status).toBe(503);expect(fetchGeocoder).not.toHaveBeenCalled();
});
test.each(['', 'a', 'x'.repeat(121), '改行\n施設', 123, null])('不正な検索語を送信しない: %s',async(q)=>{
  expect((await call(q)).status).toBe(400);expect(fetchGeocoder).not.toHaveBeenCalled();
});
test('入力語だけを識別可能なUAで送り、結果を検証して返す',async()=>{
  const response=await call('  架空の施設  ');expect(response.status).toBe(200);
  expect((await response.json()).results).toEqual([{label:found[0].display_name,latitude:35.6,longitude:139.7,zoom:16}]);
  const [url,options]=fetchGeocoder.mock.calls[0];expect(new URL(url).searchParams.get('q')).toBe('架空の施設');
  expect(new URL(url).searchParams.get('limit')).toBe('5');expect(new URL(url).searchParams.has('viewbox')).toBe(false);
  expect(options.headers['User-Agent']).toContain(env.APP_ORIGIN);expect(options.headers.Cookie).toBeUndefined();expect(url).not.toContain(ids[0]);
  expect(options.redirect).toBe('error');expect(response.headers.get('cache-control')).toBe('no-store');
  const row=db.raw.prepare('SELECT * FROM place_search_cache').get();expect(row.cache_key).toMatch(/^[a-f0-9]{64}$/);
  expect(row.expires_at-time).toBe(7*86400000);expect(JSON.stringify(row)).not.toContain('架空の施設');
});
test('別利用者・別Workerでも同じ正規化検索はキャッシュを再利用し、期限後は再取得する',async()=>{
  await call('ＴＯＫＹＯ');time+=1600;expect((await call('tokyo',1)).status).toBe(200);expect(fetchGeocoder).toHaveBeenCalledTimes(1);
  time+=7*86400000;await call('tokyo',1);expect(fetchGeocoder).toHaveBeenCalledTimes(2);
});
test('空結果もキャッシュし、キャッシュがあっても個人の連打を抑える',async()=>{
  fetchGeocoder.mockResolvedValue(Response.json([]));expect((await (await call()).json()).results).toEqual([]);
  expect((await call()).status).toBe(429);time+=1600;expect((await call()).status).toBe(200);expect(fetchGeocoder).toHaveBeenCalledTimes(1);
});
test('全利用者の間隔を確保し、1日の外部検索上限はUTC日付で更新する',async()=>{
  await call();expect((await call('別の施設',1)).status).toBe(429);expect(fetchGeocoder).toHaveBeenCalledTimes(1);
  time+=1600;expect((await call('別の施設',1)).status).toBe(200);
  db.raw.prepare('UPDATE place_search_gate SET requests=200').run();time+=1600;
  expect((await call('未検索施設')).status).toBe(429);expect(fetchGeocoder).toHaveBeenCalledTimes(2);
  time+=86400000;expect((await call('未検索施設')).status).toBe(200);
});
test('通信中の別Worker要求は待ち行列や自動再送にせず拒否する',async()=>{
  let resolve;fetchGeocoder.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const pending=call();await vi.waitFor(()=>expect(fetchGeocoder).toHaveBeenCalledTimes(1));
  time+=2000;expect((await call('別の施設',1)).status).toBe(429);expect(fetchGeocoder).toHaveBeenCalledTimes(1);
  resolve(Response.json(found));expect((await pending).status).toBe(200);
  time+=1499;expect((await call('別の施設',1)).status).toBe(429);
});
test.each([()=>Response.json([{...found[0],lat:'999'}]),()=>Response.json({bad:true}),()=>Response.json(Array(6).fill(found[0])),
  ()=>new Response('x',{status:429}),()=>Response.json([{...found[0],display_name:'x'.repeat(601)}]),
  ()=>new Response('x'.repeat(32769),{headers:{'Content-Type':'application/json'}})])('不正・過大な外部応答を拒否し、キャッシュを汚さない',async(response)=>{
  fetchGeocoder.mockImplementation(async()=>response());expect((await call()).status).toBe(502);
  expect(db.raw.prepare('SELECT count(*) n FROM place_search_cache').get().n).toBe(0);
  expect(db.raw.prepare('SELECT lease_until FROM place_search_gate').get().lease_until).toBe(0);
});
test('タイムアウト等で自動再試行せず、通信中の利用取消も反映する',async()=>{
  fetchGeocoder.mockRejectedValueOnce(new Error('timeout'));expect((await call()).status).toBe(502);expect(fetchGeocoder).toHaveBeenCalledTimes(1);
  time+=1600;fetchGeocoder.mockImplementationOnce(async()=>{db.raw.prepare("UPDATE app_members SET status='revoked' WHERE id=?").run(ids[0]);return Response.json(found);});
  expect((await call()).status).toBe(403);
});
test('移行は既存の利用者・地点を保持し、期限切れキャッシュを掃除する',async()=>{
  const previous=sqliteD1(['0001_access.sql','0002_passkeys.sql','0003_device_enrollments.sql']);
  previous.raw.prepare("INSERT INTO app_members(id,email,name,role,status,created_at,updated_at) VALUES ('previous','before@example.test','以前の利用者','owner','active',1,1)").run();
  previous.raw.exec(readFileSync(new URL('../../server/migrations/0004_place_search.sql',import.meta.url),'utf8'));
  expect(previous.raw.prepare('SELECT name FROM app_members').get().name).toBe('以前の利用者');previous.raw.close();
  await call();time+=7*86400000+1;await createHandler({now:()=>time}).scheduled(null,env);
  expect(db.raw.prepare('SELECT count(*) n FROM place_search_cache').get().n).toBe(0);
});
test('クライアントも範囲外の座標を地図へ渡さない',async()=>{
  const api=vi.fn(async()=>({results:[{label:'施設',latitude:91,longitude:139,zoom:16}]}));
  await expect(createPlaceSearchService(api).search('架空施設')).rejects.toThrow('検索結果');
  await expect(createPlaceSearchService(api).search('a')).rejects.toThrow('2〜120');expect(api).toHaveBeenCalledTimes(1);
});
