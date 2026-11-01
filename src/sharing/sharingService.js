import { validateSpotInput } from '../domain/spot.js';

export function createSharingService({ repository, api, member, onChange = () => {} }) {
  let current = member, sending = false, generation = 0;
  const report = () => onChange();
  const flush = async () => {
    if (sending || !current?.online) return;
    sending = true;
    const account = current.id;
    try {
      const rows = (await repository.list(account)).filter((row) => ['pending', 'error'].includes(row.status))
        .sort((a, b) => Number(b.action === 'revoke') - Number(a.action === 'revoke'));
      for (const row of rows) {
        if (current?.id !== account || !current.online) break;
        try {
          let result;
          try {
            result = await api(`spots/${row.spotId}`, { method: row.action === 'revoke' ? 'DELETE' : 'PUT',
              body: { operationId: row.operationId, expectedRevision: row.revision, recipients: row.recipients, spot: row.spot } });
          } catch (error) {
            if (error.status !== 409 || row.action !== 'revoke') throw error;
            // 解除は最新revisionを確認して再試行する。通常の更新は勝手に上書きしない。
            const state = await api(`spots/${row.spotId}`);
            if (state.deleted) result = { revision: state.revision };
            else result = await api(`spots/${row.spotId}`, { method: 'DELETE', body: { operationId: row.operationId, expectedRevision: state.revision } });
          }
          await repository.acknowledge(row, result.revision);
        } catch (error) { await repository.fail(row, error.message); }
      }
    } finally { sending = false; report(); }
  };
  return {
    setMember(next) { if (current?.id !== next.id) generation++; current = next; },
    suspend() { generation++; current = current ? { ...current, online: false } : null; },
    states: () => repository.list(current.id),
    async share(spot, recipients) {
      if (!Array.isArray(recipients) || !recipients.length) throw new Error('共有する相手を選んでください。');
      await repository.queue(current.id, spot.id, { spot: validateSpotInput(spot), name: spot.name, recipients: [...new Set(recipients)], action: 'publish' });
      report(); await flush();
    },
    async revoke(spotId, metadata = {}) {
      await repository.queue(current.id, spotId, { ...metadata, recipients: [], action: 'revoke' });
      report(); await flush();
    },
    async sourceChanged(spot) {
      const old = await repository.get(current.id, spot.id);
      if (!old || old.status === 'private' || old.action === 'revoke') return;
      await repository.queue(current.id, spot.id, { name: spot.name, spot: validateSpotInput(spot),
        recipients: spot.deletedAt ? [] : old.recipients, action: spot.deletedAt ? 'revoke' : 'publish' });
      report(); void flush();
    },
    async canRestore() {
      const rows = await repository.list(current.id);
      if (rows.some((row) => row.status !== 'private')) throw new Error('共有中・送信待ちの地点があります。先にすべての共有を解除し、オンラインで解除完了を確認してください。');
      if (current.online) {
        const result = await api('spots');
        if (result.spots.some((row) => row.ownerId === current.id)) throw new Error('このアカウントには共有中の地点があります。共有一覧から解除してください。');
      }
    },
    async received() {
      if (!current?.online) throw new Error('共有データの閲覧にはオンラインでの確認が必要です。');
      const cycle = generation;
      const result = await api('spots');
      if (cycle !== generation) return null;
      return result;
    },
    flush,
    close() { generation++; repository.close(); },
  };
}
