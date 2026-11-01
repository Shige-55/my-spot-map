import qrcode from 'qrcode-generator';

export function createDeviceEnrollmentUi({ root, api }) {
  const section = root.createElement('section'); section.className = 'sharing-section'; section.id = 'device-enrollment';
  section.innerHTML = `<h4>ご自身のiPhoneを追加</h4><p>登録リンクをiPhoneで開いてパスキーを作り、PCで確認コードを入力して承認します。Bluetoothは不要です。リンクは10分・1回限りです。他の人の招待には、利用者の招待を使ってください。</p>
    <button id="device-create" type="button">iPhone用の登録リンクを作成</button>
    <p id="device-message" role="status"></p><p id="device-error" role="alert" hidden></p>
    <div id="device-qr"></div><label for="device-link">ご自身のiPhoneで開く登録リンク</label><input id="device-link" type="text" readonly>
    <div id="device-approval" hidden><label for="device-code">iPhoneに表示された確認コード（8桁）</label><input id="device-code" type="text" maxlength="8" autocomplete="off" autocapitalize="characters">
    <button id="device-approve" type="button">この端末の追加を承認</button></div>
    <button id="device-cancel" type="button" hidden>端末の追加を取り消す</button>`;
  root.querySelector('#account-section').append(section);
  const q = (id) => section.querySelector('#' + id);
  const events = new globalThis.AbortController();
  let online = true, busy = false, loading = false, generation = 0, id = null, disposed = false;
  const clearLink = () => { q('device-link').value = ''; q('device-qr').replaceChildren(); q('device-code').value = ''; };
  const drawQr = (url) => {
    const qr = qrcode(0, 'M'); qr.addData(url, 'Byte'); qr.make();
    const size = qr.getModuleCount(), scale = 5, canvas = root.createElement('canvas');
    canvas.width = canvas.height = (size + 8) * scale; canvas.style.maxWidth = '100%'; canvas.style.height = 'auto';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'iPhoneのカメラで読み取る登録リンクのQRコード');
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) if (qr.isDark(row, column)) ctx.fillRect((column + 4) * scale, (row + 4) * scale, scale, scale);
    q('device-qr').replaceChildren(canvas);
  };
  const refresh = async () => {
    if (disposed || loading || busy || !online || root.visibilityState === 'hidden' || !root.querySelector('#settings-dialog').open) return;
    loading = true; const cycle = generation;
    try {
      const result = await api('devices'); if (cycle !== generation || disposed) return;
      const row = result.devices.find((item) => ['issued', 'registered'].includes(item.status));
      if (!row) { id = null; clearLink(); q('device-approval').hidden = true; q('device-cancel').hidden = true; return; }
      id = row.id; q('device-cancel').hidden = false; q('device-approval').hidden = row.status !== 'registered';
      q('device-message').textContent = row.status === 'registered' ? 'iPhoneで登録されました。iPhoneに表示された確認コードを入力して承認してください。' : 'iPhoneの標準カメラでQRコードを読み取り、Safariで登録してください。期限 '+new Date(row.expires_at).toLocaleTimeString('ja-JP');
    } catch (error) { if (cycle === generation) { q('device-error').textContent = error.message; q('device-error').hidden = false; } }
    finally { loading = false; }
  };
  const run = async (action) => {
    if (busy || !online) return; busy = true; const cycle = ++generation;
    section.querySelectorAll('button').forEach((button) => { button.disabled = true; }); q('device-error').hidden = true;
    try { await action(cycle); }
    catch (error) { if (cycle === generation) { q('device-error').textContent = error.message; q('device-error').hidden = false; } }
    finally { busy = false; section.querySelectorAll('button').forEach((button) => { button.disabled = !online; }); void refresh(); }
  };
  q('device-create').addEventListener('click', () => void run(async (cycle) => {
    const result = await api('devices', { method: 'POST', body: {} }); if (cycle !== generation) return;
    id = result.id; q('device-link').value = result.registrationUrl; drawQr(result.registrationUrl); q('device-code').value = '';
    q('device-message').textContent = 'iPhoneでQRコードを読み取ってください。';
  }), { signal: events.signal });
  q('device-approve').addEventListener('click', () => void run(async (cycle) => {
    if (!id) return; await api(`devices/${id}/approve`, { method: 'POST', body: { code: q('device-code').value } });
    if (cycle !== generation) return; clearLink(); id = null; q('device-message').textContent = '端末を承認しました。iPhoneで「パスキーでログイン」を押してください。';
  }), { signal: events.signal });
  q('device-cancel').addEventListener('click', () => void run(async (cycle) => {
    if (id) await api(`devices/${id}`, { method: 'DELETE', body: {} }); if (cycle !== generation) return;
    clearLink(); id = null; q('device-message').textContent = '端末の追加を取り消しました。';
  }), { signal: events.signal });
  const suspend = () => { generation++; clearLink(); q('device-approval').hidden = true; q('device-cancel').hidden = true; };
  const timer = window.setInterval(() => void refresh(), 3000);
  return { suspend, setOnline(value) { online = value; if (!value) suspend(); section.querySelectorAll('button').forEach((button) => { button.disabled = !value || busy; }); },
    destroy() { disposed = true; suspend(); window.clearInterval(timer); events.abort(); section.remove(); } };
}
