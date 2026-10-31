export function createBackupSettings({ root, service, onRestored }) {
  const dialog = root.querySelector('#settings-dialog');
  const openButton = root.querySelector('#open-settings');
  const closeButton = root.querySelector('#close-settings');
  const controls = root.querySelector('#backup-controls');
  const fileInput = root.querySelector('#backup-file');
  const errorPanel = root.querySelector('#backup-error');
  const status = root.querySelector('#backup-status');
  const previewPanel = root.querySelector('#restore-preview');
  const checkbox = root.querySelector('#confirm-replace');
  const restoreButton = root.querySelector('#restore-backup');
  const downloadLink = root.querySelector('#download-backup-again');
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  let prepared = null;
  let busy = false;
  let disposed = false;
  let downloadUrl = null;
  const countText = (counts) => `有効 ${counts.active}件・削除記録 ${counts.deleted}件（合計 ${counts.total}件）`;
  const confirmState = () => { restoreButton.disabled = busy || !prepared || !checkbox.checked; };
  const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
  const setBusy = (value) => {
    busy = value;
    controls.disabled = value;
    closeButton.disabled = value;
    dialog.setAttribute('aria-busy', String(value));
    window.removeEventListener('beforeunload', beforeUnload);
    if (value) window.addEventListener('beforeunload', beforeUnload);
    confirmState();
  };
  const clearPreview = () => {
    service.discard(prepared);
    prepared = null;
    checkbox.checked = false;
    previewPanel.hidden = true;
    confirmState();
  };
  const releaseDownload = () => {
    if (downloadUrl) window.URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    downloadLink.hidden = true;
    downloadLink.removeAttribute('href');
    downloadLink.removeAttribute('download');
  };
  const showError = (error) => {
    const label = { read: '読み込みエラー', validation: '検証エラー', write: '書き込みエラー', conflict: '保存内容の変更' }[error.stage];
    errorPanel.textContent = label ? `${label}: ${error.message}` : '処理を完了できませんでした。もう一度試してください。';
    errorPanel.hidden = false;
    status.hidden = true;
    errorPanel.focus();
  };
  const say = (message) => {
    status.textContent = message;
    status.hidden = false;
    errorPanel.hidden = true;
  };
  const close = () => {
    if (busy) return;
    clearPreview();
    fileInput.value = '';
    releaseDownload();
    dialog.close();
    openButton.focus();
  };
  openButton.addEventListener('click', () => {
    if (root.querySelector('dialog[open]')) return;
    clearPreview();
    fileInput.value = '';
    errorPanel.hidden = true;
    status.hidden = true;
    dialog.showModal();
    root.querySelector('#settings-heading').focus();
    dialog.scrollTop = 0;
  }, options);
  closeButton.addEventListener('click', close, options);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, options);
  fileInput.addEventListener('change', () => {
    if (busy) return;
    clearPreview();
    errorPanel.hidden = true;
    status.hidden = true;
  }, options);
  checkbox.addEventListener('change', confirmState, options);
  root.querySelector('#cancel-restore').addEventListener('click', () => {
    if (busy) return;
    clearPreview();
    fileInput.value = '';
    say('復元をキャンセルしました。保存内容は変更していません。');
    fileInput.focus();
  }, options);
  root.querySelector('#export-backup').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    say('バックアップを準備しています…');
    try {
      const backup = await service.exportBackup();
      if (disposed) return;
      releaseDownload();
      downloadUrl = window.URL.createObjectURL(new window.Blob([backup.text], { type: 'application/json;charset=utf-8' }));
      downloadLink.href = downloadUrl;
      downloadLink.download = backup.filename;
      downloadLink.hidden = false;
      downloadLink.click();
      say(`ダウンロードを開始しました。${countText(backup.counts)}。保存先のファイルを確認してください。`
        + (backup.exceedsRestoreLimit ? 'このファイルは現在の復元上限（10MiB・10,000件）を超えています。' : ''));
    } catch (error) { if (!disposed) showError(error); }
    finally { if (!disposed) setBusy(false); }
  }, options);
  root.querySelector('#validate-backup').addEventListener('click', async () => {
    if (busy) return;
    clearPreview();
    setBusy(true);
    say('ファイルの全地点を検証しています…');
    try {
      const result = await service.prepareRestore(fileInput.files[0]);
      if (disposed) { service.discard(result); return; }
      prepared = result;
      root.querySelector('#restore-filename').textContent = result.filename;
      root.querySelector('#restore-current').textContent = countText(result.current);
      root.querySelector('#restore-incoming').textContent = countText(result.incoming);
      root.querySelector('#restore-exported-at').textContent = new Date(result.exportedAt).toLocaleString('ja-JP');
      root.querySelector('#empty-restore-warning').hidden = result.incoming.total !== 0;
      previewPanel.hidden = false;
      say('全件の検証が完了しました。まだ保存内容は変更していません。');
      root.querySelector('#restore-heading').focus();
    } catch (error) { if (!disposed) showError(error); }
    finally { if (!disposed) setBusy(false); }
  }, options);
  restoreButton.addEventListener('click', async () => {
    if (busy || !prepared || !checkbox.checked) return;
    setBusy(true);
    say('全件置換して復元しています。完了まで画面を閉じないでください。');
    try {
      const result = await service.restore(prepared, { confirmed: true });
      if (disposed) return;
      clearPreview();
      fileInput.value = '';
      onRestored(result.spots);
      say(`復元が完了しました。${countText(result.counts)}。検索とカテゴリの絞り込みを解除しました。`);
      status.focus();
    } catch (error) {
      if (!disposed) {
        if (error.stage === 'conflict') clearPreview();
        showError(error);
      }
    } finally { if (!disposed) setBusy(false); }
  }, options);

  return {
    destroy() {
      disposed = true;
      events.abort();
      window.removeEventListener('beforeunload', beforeUnload);
      clearPreview();
      releaseDownload();
      if (dialog.open) dialog.close();
    },
  };
}
