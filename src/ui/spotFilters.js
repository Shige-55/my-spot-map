export function createSpotFilters({ root, onChange }) {
  const form = root.querySelector('#spot-filters');
  const query = root.querySelector('#spot-query');
  const category = root.querySelector('#category-filter');
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  let composing = false;
  const getCriteria = () => ({ query: query.value, category: category.value === '' ? null : JSON.parse(category.value) });
  const change = () => onChange(getCriteria());
  query.addEventListener('compositionstart', () => { composing = true; }, options);
  query.addEventListener('compositionend', () => { composing = false; change(); }, options);
  query.addEventListener('input', (event) => { if (!composing && !event.isComposing) change(); }, options);
  category.addEventListener('change', change, options);
  form.addEventListener('submit', (event) => { event.preventDefault(); change(); query.blur(); }, options);
  root.querySelector('#clear-filters').addEventListener('click', () => {
    form.reset();
    change();
    query.focus();
  }, options);

  return {
    getCriteria,
    reset() {
      form.reset();
      composing = false;
      change();
    },
    setCategories(categories) {
      const selected = category.value;
      const values = new Set(['', ...categories]);
      if (selected) values.add(JSON.parse(selected));
      const make = (value, label) => {
        const option = root.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      };
      category.replaceChildren(make('', 'すべてのカテゴリ'), ...[...values].sort((a, b) => a.localeCompare(b, 'ja'))
        .map((value) => make(JSON.stringify(value), value === '' ? '未分類（未設定）'
          : value === '未分類' ? '未分類（カテゴリ名）' : value)));
      category.value = selected;
    },
    destroy() { events.abort(); },
  };
}
