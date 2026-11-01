import Dexie from 'dexie';

export function createSharingRepository(name = 'my-spot-map-sharing') {
  const db = new Dexie(name);
  db.version(1).stores({ shares: '&[accountId+spotId],accountId,status' });
  return {
    get: (account, spot) => db.shares.get([account, spot]),
    list: (account) => db.shares.where('accountId').equals(account).toArray(),
    async queue(account, spotId, values) {
      return db.transaction('rw', db.shares, async () => {
        const old = await db.shares.get([account, spotId]);
        const row = { accountId: account, spotId, revision: old?.revision || 0, ...old, ...values,
          operationId: globalThis.crypto.randomUUID(), status: 'pending' };
        await db.shares.put(row); return row;
      });
    },
    async acknowledge(row, revision) {
      return db.transaction('rw', db.shares, async () => {
        const current = await db.shares.get([row.accountId, row.spotId]);
        if (!current) return;
        await db.shares.put({ ...current, revision: Math.max(current.revision, revision),
          ...(current.operationId === row.operationId ? { status: row.action === 'revoke' ? 'private' : 'shared', error: '' } : {}) });
      });
    },
    async fail(row, message) {
      await db.transaction('rw', db.shares, async () => {
        const current = await db.shares.get([row.accountId, row.spotId]);
        if (current?.operationId === row.operationId) await db.shares.put({ ...current, status: 'error', error: message });
      });
    },
    close() { db.close(); },
  };
}
