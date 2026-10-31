// 実データを使わない、単体・画面テスト共通の架空の地点。
export function testId(number = 1) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
}

export function testSpot(overrides = {}) {
  return {
    id: testId(), name: '架空の広場', memo: 'バックアップ検証用の架空データ', category: '散歩',
    latitude: 35.6, longitude: 139.7, zoom: 13,
    createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T01:00:00.000Z',
    deletedAt: null, syncStatus: 'pending', ...overrides,
  };
}

export function testBackup(spots = [testSpot()], overrides = {}) {
  return { app: 'MySpotMap', schemaVersion: 1, exportedAt: '2026-10-31T02:00:00.000Z', spots, ...overrides };
}
