import { afterEach, expect, test } from 'vitest';
import { createSharingRepository } from '../../src/sharing/sharingRepository.js';
import { createSharingService } from '../../src/sharing/sharingService.js';

const resources = [];
afterEach(() => { for (const resource of resources) resource.close(); resources.length = 0; });
const repository = () => { const value = createSharingRepository('fixture-sharing-' + globalThis.crypto.randomUUID()); resources.push(value); return value; };
const spot = { id: '10000000-0000-4000-8000-000000000001', name: '架空地点', memo: '', category: '', latitude: 35, longitude: 139, zoom: 13 };
const member = { id: 'fixture-a', online: true };

test('遅れて届いた共有成功・失敗が、後から要求した解除を取り消さない', async () => {
  const repo = repository();
  const publish = await repo.queue(member.id, spot.id, { action: 'publish', recipients: ['fixture-b'], spot });
  const removal = await repo.queue(member.id, spot.id, { action: 'revoke', recipients: [] });
  await repo.acknowledge(publish, 1); await repo.fail(publish, '古いエラー');
  const pending = await repo.get(member.id, spot.id);
  expect(pending.operationId).toBe(removal.operationId); expect(pending.action).toBe('revoke');
  expect(pending.status).toBe('pending'); expect(pending.revision).toBe(1);
  await repo.acknowledge(pending, 2); expect((await repo.get(member.id, spot.id)).status).toBe('private');
});

test('オフラインの解除は解除済みとせず、復元を止めて再接続後に失効を確認する', async () => {
  const repo = repository(); let writes = 0;
  const service = createSharingService({ repository: repo, member: { ...member, online: false }, api: async () => { writes++; return { revision: 1 }; } });
  await service.revoke(spot.id); expect(writes).toBe(0);
  expect((await service.states())[0].status).toBe('pending');
  await expect(service.canRestore()).rejects.toThrow('共有');
  service.setMember(member); await service.flush();
  expect(writes).toBe(1); expect((await service.states())[0].status).toBe('private');
});

test('解除のrevision競合では最新状態を確認し、更新を勝手に上書きしない', async () => {
  const repo = repository(); let attempts = 0; const calls = [];
  const service = createSharingService({ repository: repo, member, api: async (path, options = {}) => {
    calls.push(options.method || 'GET');
    if (options.method === 'DELETE' && !attempts++) throw Object.assign(new Error('競合'), { status: 409 });
    if (!options.method) return { revision: 4, deleted: false };
    expect(options.body.expectedRevision).toBe(4); return { revision: 5 };
  } });
  await service.revoke(spot.id); expect(calls).toEqual(['DELETE', 'GET', 'DELETE']);
  expect((await service.states())[0]).toMatchObject({ status: 'private', revision: 5 });
});

test('アカウント切替で別人の送信待ちと遅れた受信応答を使わない', async () => {
  const repo = repository(); let resolve; const calls = [];
  await repo.queue(member.id, spot.id, { action: 'publish', recipients: ['fixture-b'], spot });
  const service = createSharingService({ repository: repo, member, api: (path) => { calls.push(path); return new Promise((done) => { resolve = done; }); } });
  const receiving = service.received();
  service.setMember({ id: 'fixture-c', online: true }); resolve({ spots: [{ ownerId: member.id, spot }] });
  expect(await receiving).toBeNull(); await service.flush(); expect(calls).toEqual(['spots']);
});
