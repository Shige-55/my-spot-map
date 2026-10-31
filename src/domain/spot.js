export class SpotValidationError extends Error {
  constructor(fields) {
    super(Object.values(fields).join(' '));
    this.name = 'SpotValidationError';
    this.fields = fields;
  }
}

export class SpotNotFoundError extends Error {
  constructor() {
    super('この地点は見つからないか、既に削除されています。一覧を読み直してください。');
    this.name = 'SpotNotFoundError';
  }
}

export const editableFields = ['name', 'memo', 'category', 'latitude', 'longitude', 'zoom'];

export function normalizeSearch(value) {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function filterSpots(spots, { query = '', category = null } = {}) {
  const normalized = normalizeSearch(query);
  return spots.filter((spot) => spot.deletedAt === null
    && (category === null || spot.category === category)
    && (!normalized || normalizeSearch(spot.name).includes(normalized)
      || normalizeSearch(spot.memo).includes(normalized)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .map((spot) => ({ ...spot }));
}

export function validateSpotInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpotValidationError({ form: '地点の入力形式が正しくありません。' });
  }
  const fields = {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const memo = input.memo === undefined ? '' : input.memo;
  const category = input.category === undefined ? ''
    : typeof input.category === 'string' ? input.category.trim() : input.category;
  if (!name || [...name].length > 100) fields.name = '名前は空白を除いて1〜100文字で入力してください。';
  if (typeof memo !== 'string' || [...memo].length > 2000) fields.memo = 'メモは2000文字以内で入力してください。';
  if (typeof category !== 'string' || [...category].length > 50) fields.category = 'カテゴリは50文字以内で入力してください。';
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    fields.latitude = '緯度は−90〜90の数値で入力してください。';
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    fields.longitude = '経度は−180〜180の数値で入力してください。';
  }
  if (!Number.isInteger(input.zoom) || input.zoom < 0 || input.zoom > 19) {
    fields.zoom = '表示倍率は0〜19の整数にしてください。';
  }
  if (Object.keys(fields).length) throw new SpotValidationError(fields);
  return { name, memo, category, latitude: input.latitude, longitude: input.longitude, zoom: input.zoom };
}
