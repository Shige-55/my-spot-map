import { editableFields, filterSpots, SpotNotFoundError, SpotValidationError, validateSpotInput } from '../domain/spot.js';
import { BackupConflictError, snapshotSpots, validateBackupSpots } from '../domain/backup.js';

export function createSpotRepository(db, {
  now = () => new Date().toISOString(),
  createId = () => globalThis.crypto.randomUUID(),
} = {}) {
  const timestamp = (previous) => new Date(Math.max(
    Date.parse(now()), previous ? Date.parse(previous) + 1 : 0,
  )).toISOString();
  const requireSpot = async (id) => {
    const spot = await db.spots.get(id);
    if (!spot || spot.deletedAt !== null) throw new SpotNotFoundError();
    return spot;
  };

  return {
    async exportAll() {
      await db.open();
      return db.transaction('r', db.spots, async () => {
        const spots = await db.spots.toArray();
        return spots.sort((a, b) => a.id.localeCompare(b.id)).map((spot) => ({ ...spot }));
      });
    },
    async replaceAll(validatedSpots, { expectedSnapshot } = {}) {
      // Repositoryから直接呼ばれても、不正データのままclearへ進めない。
      const spots = validateBackupSpots(validatedSpots, { resetSyncStatus: true });
      await db.open();
      return db.transaction('rw', db.spots, async () => {
        if (expectedSnapshot !== undefined && snapshotSpots(await db.spots.toArray()) !== expectedSnapshot) {
          throw new BackupConflictError();
        }
        await db.spots.clear();
        await db.spots.bulkAdd(spots);
        return spots.map((spot) => ({ ...spot }));
      });
    },
    async list(criteria) {
      await db.open();
      const spots = await db.spots.filter((spot) => spot.deletedAt === null).toArray();
      return filterSpots(spots, criteria);
    },
    async get(id) {
      await db.open();
      const spot = await db.spots.get(id);
      return spot?.deletedAt === null ? { ...spot } : null;
    },
    async create(input) {
      const data = validateSpotInput(input);
      await db.open();
      const date = timestamp();
      const spot = {
        ...data, id: createId(), createdAt: date, updatedAt: date,
        deletedAt: null, syncStatus: 'pending',
      };
      await db.transaction('rw', db.spots, () => db.spots.add(spot));
      return { ...spot };
    },
    async update(id, patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !editableFields.includes(key))) {
        throw new SpotValidationError({ form: '変更できない項目が含まれています。' });
      }
      await db.open();
      return db.transaction('rw', db.spots, async () => {
        const previous = await requireSpot(id);
        const data = validateSpotInput({ ...previous, ...patch });
        const spot = { ...previous, ...data, updatedAt: timestamp(previous.updatedAt), syncStatus: 'pending' };
        await db.spots.put(spot);
        return { ...spot };
      });
    },
    async softDelete(id) {
      await db.open();
      return db.transaction('rw', db.spots, async () => {
        const previous = await requireSpot(id);
        const date = timestamp(previous.updatedAt);
        const spot = { ...previous, deletedAt: date, updatedAt: date, syncStatus: 'pending' };
        await db.spots.put(spot);
        return { ...spot };
      });
    },
  };
}
