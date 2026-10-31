import { createSpotList } from './spotList.js';
import { createSpotForm } from './spotForm.js';
import { createSpotFilters } from './spotFilters.js';
import { createBackupSettings } from './backupSettings.js';

export function createSpotApp({ root, service, backupService, mapController, viewTabs, locate }) {
  let spots = [];
  let visibleSpots = [];
  let criteria = { query: '', category: null };
  let selectedId = null;
  let deletingId = null;
  let deleting = false;
  let disposed = false;
  const register = root.querySelector('#register-center');
  const readError = root.querySelector('#read-error');
  const status = root.querySelector('#app-status');
  const deleteDialog = root.querySelector('#delete-dialog');
  const deleteError = root.querySelector('#delete-error');
  const confirmDelete = root.querySelector('#confirm-delete');
  const cancelDelete = root.querySelector('#cancel-delete');
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  const announce = (message) => {
    status.textContent = message;
    status.hidden = false;
  };
  const render = () => {
    visibleSpots = service.filter(spots, criteria);
    if (!visibleSpots.some((spot) => spot.id === selectedId)) selectedId = null;
    const categories = [...new Set(spots.map((spot) => spot.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ja'));
    filters.setCategories(categories);
    form.setCategories(categories);
    list.render(visibleSpots, selectedId, spots.length);
    mapController.setSpots(visibleSpots, selectedId);
  };
  const filters = createSpotFilters({ root, onChange: (next) => { criteria = next; render(); } });
  const select = (id) => {
    const spot = service.filter(spots, criteria).find((spot) => spot.id === id);
    if (!spot) return;
    selectedId = id;
    viewTabs.showMap();
    render();
    mapController.focusSpot(spot);
  };
  const closeDelete = () => {
    deleteDialog.close();
    list.focusSelected(deletingId);
    if (!visibleSpots.some((spot) => spot.id === deletingId)) {
      if (!root.querySelector('#list-panel').hidden) root.querySelector('#spot-query').focus();
      else register.focus();
    }
    deletingId = null;
  };
  const list = createSpotList({
    root, onSelect: select,
    onEdit: (id) => form.openEdit(spots.find((spot) => spot.id === id)),
    onDelete: (id) => {
      deletingId = id;
      root.querySelector('#delete-description').textContent = `「${spots.find((spot) => spot.id === id).name}」を一覧と地図から削除します。`;
      deleteError.hidden = true;
      deleteDialog.showModal();
      cancelDelete.focus();
    },
  });
  const form = createSpotForm({
    root,
    onSave: async (id, input) => {
      const saved = id ? await service.update(id, input) : await service.create(input);
      spots = [...spots.filter((spot) => spot.id !== saved.id), saved];
      render();
      const visible = visibleSpots.some((spot) => spot.id === saved.id);
      if (visible) select(saved.id);
      announce((id ? '地点の変更を保存しました。' : '地点を保存しました。')
        + (visible ? '' : '現在の絞り込み条件では表示されません。'));
    },
  });
  const load = async () => {
    register.disabled = true;
    root.querySelector('#open-settings').disabled = true;
    root.querySelector('#retry-load').disabled = true;
    try {
      const loaded = await service.list();
      if (disposed) return;
      spots = loaded;
      if (!spots.some((spot) => spot.id === selectedId)) selectedId = null;
      readError.hidden = true;
      render();
    } catch (error) {
      if (disposed) return;
      readError.querySelector('p').textContent = error.message;
      readError.hidden = false;
      root.querySelector('.empty-state').hidden = true;
    } finally {
      if (!disposed) {
        register.disabled = false;
        root.querySelector('#open-settings').disabled = false;
        root.querySelector('#retry-load').disabled = false;
      }
    }
  };
  register.addEventListener('click', () => form.openCreate(mapController.getView()), options);
  mapController.onRegister((view) => {
    if (!register.disabled && !root.querySelector('dialog[open]')) form.openCreate(view);
  });
  const locationButton = root.querySelector('#locate');
  const locationStatus = root.querySelector('#location-status');
  locationButton.addEventListener('click', async () => {
    if (locationButton.disabled) return;
    locationButton.disabled = true;
    locationButton.textContent = '取得中…';
    locationStatus.textContent = '現在地を取得しています…';
    locationStatus.hidden = false;
    try {
      const position = await locate();
      if (disposed) return;
      viewTabs.showMap();
      mapController.showLocation(position);
      locationStatus.textContent = `現在地を表示しました（推定精度 約${Math.round(position.accuracy)}m）。地点としては保存しません。`;
    } catch (error) {
      if (!disposed) locationStatus.textContent = error.message;
    } finally {
      if (!disposed) {
        locationButton.disabled = false;
        locationButton.textContent = '現在地';
      }
    }
  }, options);
  root.querySelector('#retry-load').addEventListener('click', load, options);
  cancelDelete.addEventListener('click', closeDelete, options);
  deleteDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!deleting) closeDelete();
  }, options);
  root.querySelector('#delete-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (deleting) return;
    deleting = true;
    confirmDelete.disabled = true;
    cancelDelete.disabled = true;
    confirmDelete.textContent = '削除中…';
    deleteError.hidden = true;
    try {
      await service.remove(deletingId);
      spots = spots.filter((spot) => spot.id !== deletingId);
      if (selectedId === deletingId) selectedId = null;
      render();
      closeDelete();
      announce('地点を削除しました。');
    } catch (error) {
      deleteError.textContent = error.message;
      deleteError.hidden = false;
      deleteError.focus();
    } finally {
      deleting = false;
      confirmDelete.disabled = false;
      cancelDelete.disabled = false;
      confirmDelete.textContent = '削除する';
    }
  }, options);
  const backupSettings = createBackupSettings({
    root, service: backupService,
    onRestored: (restored) => {
      spots = restored.filter((spot) => spot.deletedAt === null);
      selectedId = null;
      readError.hidden = true;
      filters.reset();
      announce('バックアップから地点を復元しました。');
    },
  });
  mapController.onSpotSelect(select);
  void load();

  return {
    destroy() {
      disposed = true;
      events.abort();
      form.destroy();
      backupSettings.destroy();
      filters.destroy();
      list.destroy();
      mapController.onSpotSelect(() => {});
      mapController.onRegister(() => {});
      if (deleteDialog.open) deleteDialog.close();
    },
  };
}
