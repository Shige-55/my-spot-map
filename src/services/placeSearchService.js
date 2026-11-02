export function createPlaceSearchService(api) {
  return {
    async search(query, signal) {
      const text = query.normalize('NFKC').trim();
      if ([...text].length < 2 || [...text].length > 120) throw new Error('住所・施設名を2〜120文字で入力してください。');
      const data = await api('place-search', { method: 'POST', body: { query: text }, signal });
      if (!Array.isArray(data.results) || data.results.length > 5 || data.results.some((item) =>
        typeof item.label !== 'string' || !item.label.trim() || [...item.label].length > 600
        || !Number.isFinite(item.latitude) || Math.abs(item.latitude) > 90
        || !Number.isFinite(item.longitude) || Math.abs(item.longitude) > 180 || item.zoom !== 16)) {
        throw new Error('検索結果を確認できませんでした。もう一度検索してください。');
      }
      return data.results;
    },
  };
}
