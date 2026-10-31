export function createViewTabs({ root, onMapVisible }) {
  const tabList = root.querySelector('.view-tabs');
  const tabs = [...tabList.querySelectorAll('[role="tab"]')];
  const mapPanel = root.querySelector('#map-panel');
  const listPanel = root.querySelector('#list-panel');
  // CSSと同じブレークポイントを使い、PCでは両方のパネルを表示する。
  const desktop = window.matchMedia('(min-width: 768px)');
  let activeId = 'map-tab';

  const render = () => {
    for (const tab of tabs) {
      const selected = tab.id === activeId;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    mapPanel.hidden = !desktop.matches && activeId !== 'map-tab';
    listPanel.hidden = !desktop.matches && activeId !== 'list-tab';

    for (const [panel, tab] of [[mapPanel, tabs[0]], [listPanel, tabs[1]]]) {
      if (desktop.matches) {
        panel.removeAttribute('role');
        panel.setAttribute('aria-labelledby', panel === mapPanel ? 'map-heading' : 'list-heading');
        panel.removeAttribute('tabindex');
      } else {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        panel.tabIndex = 0;
      }
    }
    if (!mapPanel.hidden) onMapVisible();
  };

  const select = (tab) => {
    activeId = tab.id;
    render();
    tab.focus();
  };
  const onClick = (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tabs.includes(tab)) select(tab);
  };
  const onKeyDown = (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[next]);
  };
  const onLayoutChange = () => {
    const focused = root.activeElement;
    render();
    // 幅変更でフォーカス先が非表示になる場合は、表示中の操作領域へ移す。
    if (desktop.matches && tabList.contains(focused)) {
      root.querySelector('#map').focus();
    } else if (!desktop.matches && (mapPanel.hidden && mapPanel.contains(focused)
      || listPanel.hidden && listPanel.contains(focused))) {
      tabs.find((tab) => tab.id === activeId).focus();
    }
  };

  tabList.addEventListener('click', onClick);
  tabList.addEventListener('keydown', onKeyDown);
  desktop.addEventListener('change', onLayoutChange);
  render();

  return {
    showMap() {
      activeId = 'map-tab';
      render();
      root.querySelector('#map').focus();
    },
    destroy() {
      tabList.removeEventListener('click', onClick);
      tabList.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onLayoutChange);
    },
  };
}
