export function createSpotList({ root, onSelect, onEdit, onDelete }) {
  const list = root.querySelector('#spot-list');
  const document = root;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const click = (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !list.contains(button)) return;
    const id = button.closest('[data-spot-id]').dataset.spotId;
    ({ select: onSelect, edit: onEdit, delete: onDelete })[button.dataset.action](id);
  };
  list.addEventListener('click', click);

  return {
    render(spots, selectedId, total = spots.length) {
      const fragment = document.createDocumentFragment();
      for (const spot of spots) {
        const item = make('li', 'spot-card');
        item.dataset.spotId = spot.id;
        const select = make('button', 'spot-select');
        select.type = 'button';
        select.dataset.action = 'select';
        select.setAttribute('aria-pressed', String(spot.id === selectedId));
        select.setAttribute('aria-label', `${spot.name}を地図で表示`);
        select.append(make('span', 'spot-name', spot.name),
          make('span', 'spot-category', spot.category || '未分類'),
          make('span', 'spot-coordinates', `${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)}`));
        if (spot.memo) select.append(make('span', 'spot-memo', spot.memo));
        const actions = make('div', 'spot-actions');
        for (const [action, label] of [['edit', '編集'], ['delete', '削除']]) {
          const button = make('button', 'text-button', label);
          button.type = 'button';
          button.dataset.action = action;
          button.setAttribute('aria-label', `${spot.name}を${label}`);
          actions.append(button);
        }
        item.append(select, actions);
        fragment.append(item);
      }
      list.replaceChildren(fragment);
      root.querySelector('.empty-state').hidden = spots.length > 0;
      root.querySelector('.empty-state h3').textContent = total ? '条件に一致する地点はありません' : 'まだ登録地点はありません';
      root.querySelector('.empty-state p').textContent = total
        ? '検索語やカテゴリを変えるか、「絞り込みを解除」を押してください。'
        : '地図の長押し・右クリック、または「地図中心を登録」から追加できます。';
      root.querySelector('.count-badge').textContent = spots.length === total ? `${total}件` : `${spots.length} / ${total}件`;
      root.querySelector('.tab-count').textContent = String(spots.length);
      root.querySelector('#filter-summary').textContent = `${spots.length}件を表示 / 全${total}件`;
    },
    focusSelected(id) {
      const item = [...list.children].find((child) => child.dataset.spotId === id);
      item?.querySelector('.spot-select').focus();
    },
    destroy() { list.removeEventListener('click', click); },
  };
}
