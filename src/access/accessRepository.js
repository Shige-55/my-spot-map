import Dexie from 'dexie';

// 個人地点のDBと分離し、JSONバックアップへ含めない。
export function createAccessRepository(name = 'my-spot-map-access') {
  const db = new Dexie(name);
  db.version(1).stores({ state: 'key' });
  return {
    async device() {
      return db.transaction('rw', db.state, async () => {
        let value = await db.state.get('device');
        if (!value) { value = { key: 'device', value: globalThis.crypto.randomUUID() }; await db.state.put(value); }
        return value.value;
      });
    },
    async load() { return (await db.state.get('permit'))?.value || null; },
    async save(value) { await db.state.put({ key: 'permit', value }); },
    async clear() { await db.state.delete('permit'); },
    async blockedSession() { return (await db.state.get('blocked-session'))?.value || ''; },
    async blockSession() {
      await db.transaction('rw', db.state, async () => {
        const permit = (await db.state.get('permit'))?.value;
        if (permit?.sessionId) await db.state.put({ key: 'blocked-session', value: permit.sessionId });
        await db.state.delete('permit');
      });
    },
    close() { db.close(); },
  };
}
