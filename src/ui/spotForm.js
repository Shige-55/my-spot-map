export function createSpotForm({ root, onSave }) {
  const dialog = root.querySelector('#spot-dialog');
  const form = root.querySelector('#spot-form');
  const fields = root.querySelector('#spot-fields');
  const error = root.querySelector('#form-error');
  const save = root.querySelector('#save-spot');
  const cancel = root.querySelector('#cancel-spot');
  const controls = Object.fromEntries(['name', 'memo', 'category', 'latitude', 'longitude']
    .map((key) => [key, form.elements.namedItem(key)]));
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  let editingId = null;
  let zoom = 13;
  let busy = false;
  let initial = '';
  let opener;
  const values = () => JSON.stringify(Object.values(controls).map((control) => control.value));
  const beforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = '';
  };
  const trackChanges = () => {
    window.removeEventListener('beforeunload', beforeUnload);
    if (dialog.open && values() !== initial) window.addEventListener('beforeunload', beforeUnload);
  };
  const resetError = () => {
    error.hidden = true;
    error.textContent = '';
    for (const control of Object.values(controls)) {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  };
  const setBusy = (value) => {
    busy = value;
    fields.disabled = value;
    cancel.disabled = value;
    save.disabled = value;
    save.textContent = value ? '保存中…' : '保存';
    form.setAttribute('aria-busy', String(value));
  };
  const close = () => {
    dialog.close();
    window.removeEventListener('beforeunload', beforeUnload);
    if (opener?.isConnected && opener.getClientRects().length) opener.focus();
    else if (!root.querySelector('#list-panel').hidden) root.querySelector('#spot-query').focus();
    else root.querySelector('#register-center').focus();
  };
  const open = (spot, id) => {
    editingId = id;
    zoom = spot.zoom;
    opener = root.activeElement;
    form.reset();
    resetError();
    setBusy(false);
    for (const [key, control] of Object.entries(controls)) control.value = spot[key] ?? '';
    initial = values();
    root.querySelector('#spot-dialog-heading').textContent = id ? '地点を編集' : '地点を登録';
    root.querySelector('#spot-zoom').textContent = `保存する表示倍率: ${zoom}（地図の倍率を保持します）`;
    dialog.showModal();
    controls.name.focus();
  };
  form.addEventListener('input', () => { resetError(); trackChanges(); }, options);
  cancel.addEventListener('click', close, options);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!busy) close();
  }, options);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    resetError();
    setBusy(true);
    const coordinate = (control) => control.value.trim() === '' ? NaN : Number(control.value.trim());
    try {
      await onSave(editingId, {
        name: controls.name.value, memo: controls.memo.value, category: controls.category.value,
        latitude: coordinate(controls.latitude), longitude: coordinate(controls.longitude), zoom,
      });
      close();
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
      for (const key of Object.keys(cause.fields || {})) {
        controls[key]?.setAttribute('aria-invalid', 'true');
        controls[key]?.setAttribute('aria-describedby', 'form-error');
      }
      error.focus();
    } finally {
      setBusy(false);
    }
  }, options);

  return {
    setCategories(categories) {
      root.querySelector('#category-options').replaceChildren(...categories.map((value) => {
        const option = root.createElement('option');
        option.value = value;
        return option;
      }));
    },
    openCreate: (view) => open({ ...view, name: '', memo: '' }, null),
    openEdit: (spot) => open(spot, spot.id),
    destroy() {
      events.abort();
      window.removeEventListener('beforeunload', beforeUnload);
      if (dialog.open) dialog.close();
    },
  };
}
