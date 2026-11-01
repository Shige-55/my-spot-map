import { createSharingRepository } from '../sharing/sharingRepository.js';
import { createSharingService } from '../sharing/sharingService.js';
import { createLiveLocationService } from '../sharing/liveLocationService.js';

const element = (tag, text, className) => {
  const node = window.document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
};

export function createSharingUi({ root, api, member, spotRepository, mapController, viewTabs }) {
  let current = member, contacts = [], ownSpots = [], cloudSpots = [], generation = 0, loading = false, busy = false, disposed = false;
  const section = element('section', undefined, 'sharing-section'); section.id = 'sharing-settings';
  section.innerHTML = `<h3>家族・知人との共有</h3>
    <p><a href="/auth/add">追加のパスキーを登録</a>（10分以内のログインが必要です。別の端末や保存先を使ってください）</p>
    <p id="sharing-error" role="alert" hidden></p>
    <label for="sharing-name">相手に表示する名前</label><input id="sharing-name" type="text" maxlength="120"><button id="sharing-profile" type="button">名前を保存</button>
    <label for="sharing-code">あなたの共有用ID（利用招待済みの相手へ伝えてください）</label><input id="sharing-code" type="text" readonly>
    <label for="sharing-contact">相手の共有用ID</label><input id="sharing-contact" type="text" autocomplete="off"><button id="sharing-contact-add" type="button">共有相手を申請</button><div id="sharing-contacts"></div>
    <div class="sharing-section"><h4>現在地の共有</h4><p>双方の共有ONと前面表示中だけ送信します。閉じる・ロック・通信断で停止し、復帰後は開始し直してください。</p>
      <div id="live-peer-options"></div><button id="sharing-live-start" type="button">現在地共有を開始</button><button id="sharing-live-stop" type="button">現在地共有を停止</button><p id="sharing-live-state" role="status">現在地の共有は停止中です。</p></div>
    <div class="sharing-section"><h4>登録地点の共有</h4><label for="sharing-spot">共有する自分の地点</label><select id="sharing-spot"></select>
      <p>名前・メモ・カテゴリ・緯度経度・表示倍率を共有します。共有先だけが閲覧でき、相手による編集はできません。</p>
      <div id="spot-peer-options"></div><button id="sharing-publish" type="button">選択した相手へ共有</button><button id="sharing-revoke" type="button">この地点の共有を解除</button>
      <button id="sharing-retry" type="button">送信待ちを再試行</button><div id="sharing-own"></div></div>
    <div id="sharing-admin" class="sharing-section" hidden><h4>利用者の招待（管理者専用）</h4><p>利用招待と地点の共有許可は別です。招待された人も他人の地点を自動的には閲覧できません。</p>
      <label for="sharing-invite-email">招待相手の連絡用メールアドレス</label><input id="sharing-invite-email" type="email" autocomplete="off"><button id="sharing-invite" type="button">利用者を招待</button>
      <p>メールは自動送信しません。招待リンクを本人へ直接渡し、パスキーの登録申請が本人から届いたことを確認して承認してください。</p>
      <label for="sharing-invite-link">招待リンク（本人へ直接渡してください。登録後に本人確認・承認が必要です）</label><input id="sharing-invite-link" type="text" readonly><div id="sharing-members"></div></div>`;
  root.querySelector('#account-section').after(section);
  const sharedSection = element('section', undefined, 'sharing-section'); sharedSection.id = 'received-spots';
  sharedSection.append(element('h3', '共有された地点'), element('p', 'オンラインで許可を確認できる間だけ表示します。'));
  const receivedList = element('div'); sharedSection.append(receivedList); root.querySelector('#spot-list').after(sharedSection);
  const q = (id) => root.querySelector('#' + id);
  q('sharing-name').value = member.name; q('sharing-code').value = member.id;
  const events = new globalThis.AbortController();
  const report = (error) => { q('sharing-error').textContent = error.message; q('sharing-error').hidden = false; };
  const service = createSharingService({ repository: createSharingRepository(), api, member, onChange: () => void renderOwn() });
  const live = createLiveLocationService({ api, onChange: (state) => {
    q('sharing-live-state').textContent = state.message;
    mapController.setSharedLocations(state.positions);
  } });
  const choices = (id, peers) => {
    const container = q(id);
    const selected = new Set([...container.querySelectorAll('input:checked')].map((input) => input.value));
    container.replaceChildren();
    for (const peer of peers) {
      const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.value = peer.id; input.checked = selected.has(peer.id);
      label.append(input, element('span', peer.name)); container.append(label);
    }
    if (!peers.length) container.append(element('p', '共有相手の申請と承認が必要です。'));
  };
  const selected = (id) => [...q(id).querySelectorAll('input:checked')].map((input) => input.value);
  const action = (name, callback) => {
    const button = element('button', name); button.type = 'button'; button.addEventListener('click', () => void run(callback), { signal: events.signal }); return button;
  };
  const run = async (callback) => {
    if (busy) return; busy = true; q('sharing-error').hidden = true;
    section.setAttribute('aria-busy', 'true');
    try { await callback(); }
    catch (error) { report(error); }
    finally { busy = false; section.removeAttribute('aria-busy'); void refresh(); }
  };
  const bind = (id, callback) => q(id).addEventListener('click', () => void run(callback), { signal: events.signal });
  const renderOwn = async () => {
    try {
      const states = await service.states(); if (disposed) return;
      const container = q('sharing-own'); container.replaceChildren();
      const labels = { private: '非共有', shared: '共有中', pending: '送信待ち', error: '共有エラー' };
      for (const row of states.filter((row) => row.status !== 'private')) {
        const entry = element('div', undefined, 'sharing-row');
        entry.append(element('p', `${row.name || '地点'}：${row.action === 'revoke' ? '共有解除待ち' : labels[row.status]}${row.error ? '／' + row.error : ''}`),
          action('共有を解除', () => service.revoke(row.spotId))); container.append(entry);
      }
      for (const remote of cloudSpots.filter((item) => item.ownerId === current.id && !states.some((row) => row.spotId === item.spotId && row.status !== 'private'))) {
        const entry = element('div', undefined, 'sharing-row'); entry.append(element('p', `${remote.spot.name}：他の端末から共有中`),
          action('この共有を解除', () => service.revoke(remote.spotId, { revision: remote.revision, name: remote.spot.name })));
        container.append(entry);
      }
    } catch (error) { report(error); }
  };
  const renderReceived = () => {
    const incoming = cloudSpots.filter((row) => row.ownerId !== current.id);
    receivedList.replaceChildren();
    for (const row of incoming) {
      const entry = element('div', undefined, 'sharing-row');
      entry.append(action(`${row.spot.name}（${row.ownerName}）を地図で表示`, async () => { viewTabs.showMap(); mapController.focusSpot(row.spot); }),
        element('p', row.spot.memo), element('p', row.spot.category || '未分類'));
      receivedList.append(entry);
    }
    if (!incoming.length) receivedList.append(element('p', current.online ? '共有された地点はありません。' : '共有地点の閲覧には通信が必要です。'));
    mapController.setSharedSpots(incoming);
  };
  const clearReceived = () => { cloudSpots = []; renderReceived(); };
  let expiry;
  const refresh = async () => {
    if (loading || disposed || root.visibilityState === 'hidden' || !current.online) return;
    loading = true;
    const cycle = generation, started = window.performance.now();
    try {
      const [contactData, spots, received] = await Promise.all([api('contacts'), spotRepository.list(), service.received()]);
      if (cycle !== generation || !received || disposed) return;
      contacts = contactData.contacts; ownSpots = spots; cloudSpots = received.spots;
      const ttl = Math.max(0, received.validUntil - received.serverNow - (window.performance.now() - started));
      if (!ttl) { clearReceived(); return; }
      window.clearTimeout(expiry); expiry = window.setTimeout(clearReceived, Math.min(15000, ttl));
      const spotId = q('sharing-spot').value; q('sharing-spot').replaceChildren();
      q('sharing-spot').append(element('option', '地点を選んでください'));
      q('sharing-spot').firstElementChild.value = '';
      for (const spot of spots) { const option = element('option', spot.name); option.value = spot.id; q('sharing-spot').append(option); }
      q('sharing-spot').value = spots.some((spot) => spot.id === spotId) ? spotId : '';
      const accepted = contacts.filter((peer) => peer.status === 'accepted');
      choices('live-peer-options', accepted); choices('spot-peer-options', accepted);
      q('sharing-contacts').replaceChildren();
      for (const peer of contacts) {
        const row = element('div', undefined, 'sharing-row'); row.append(element('p', `${peer.name}：${peer.status === 'accepted' ? '共有相手' : '承認待ち'}`));
        if (peer.status === 'pending' && peer.recipient === current.id) row.append(action('共有申請を承認', () => api(`contacts/${peer.id}`, { method: 'PUT', body: {} })));
        row.append(action('共有相手を解除', async () => { await live.stop(); await api(`contacts/${peer.id}`, { method: 'DELETE', body: {} }); clearReceived(); }));
        q('sharing-contacts').append(row);
      }
      renderReceived(); await renderOwn();
      q('sharing-admin').hidden = current.role !== 'owner';
      if (current.role === 'owner' && q('settings-dialog').open) {
        const result = await api('members'); if (cycle !== generation || disposed) return;
        q('sharing-members').replaceChildren();
        for (const item of result.members.filter((row) => row.role !== 'owner')) {
          const row = element('div', undefined, 'sharing-row');
          row.append(element('p', `${item.email}：${item.status === 'invited' && item.has_passkey ? '登録済み・管理者承認待ち' : { active: '利用中', invited: '招待中', revoked: '利用停止' }[item.status]}`));
          if (item.status === 'invited' && item.has_passkey) row.append(action('本人の登録を確認して承認', () => api(`members/${item.id}/approve`, { method: 'POST', body: {} })));
          row.append(action('利用を停止', async () => {
            await api(`members/${item.id}`, { method: 'DELETE', body: {} }); clearReceived();
          })); q('sharing-members').append(row);
        }
      }
    } catch (error) { clearReceived(); if (q('settings-dialog').open) report(error); }
    finally { loading = false; }
  };
  bind('sharing-profile', async () => { await api('profile', { method: 'PUT', body: { name: q('sharing-name').value } }); });
  bind('sharing-contact-add', () => api('contacts', { method: 'POST', body: { userId: q('sharing-contact').value.trim() } }));
  bind('sharing-live-start', () => live.start(selected('live-peer-options')));
  // 停止は他の処理中も優先する。
  q('sharing-live-stop').addEventListener('click', () => void live.stop(), { signal: events.signal });
  bind('sharing-publish', async () => {
    const spot = ownSpots.find((item) => item.id === q('sharing-spot').value);
    if (!spot) throw new Error('共有する地点を選んでください。');
    await service.share(spot, selected('spot-peer-options'));
  });
  bind('sharing-revoke', async () => { if (!q('sharing-spot').value) throw new Error('地点を選んでください。'); await service.revoke(q('sharing-spot').value); });
  bind('sharing-retry', service.flush);
  bind('sharing-invite', async () => {
    const result = await api('invitations', { method: 'POST', body: { email: q('sharing-invite-email').value } });
    q('sharing-invite-link').value = result.invitationUrl; q('sharing-invite-email').value = '';
  });
  const suspend = () => {
    generation++; service.suspend(); void live.stop(); window.clearTimeout(expiry);
    contacts = []; clearReceived(); q('sharing-contacts').replaceChildren(); choices('live-peer-options', []); choices('spot-peer-options', []);
    q('sharing-members').replaceChildren(); q('sharing-invite-link').value = '';
  };
  window.addEventListener('pagehide', suspend, { signal: events.signal });
  root.addEventListener('visibilitychange', () => { if (root.visibilityState === 'hidden') suspend(); }, { signal: events.signal });
  const timer = window.setInterval(() => void refresh(), 5000);
  void refresh();
  return {
    setMember(next) {
      current = next; service.setMember(next); section.querySelectorAll('button:not(#sharing-live-stop):not(#sharing-revoke)').forEach((button) => { button.disabled = !next.online; });
      if (next.online) { void service.flush(); void refresh(); } else suspend();
    },
    suspend,
    async sourceChanged(spot) { try { await service.sourceChanged(spot); } catch (error) { report(new Error('地点は保存しましたが共有更新を準備できませんでした。' + error.message)); } },
    canRestore: service.canRestore,
    destroy() { disposed = true; suspend(); window.clearInterval(timer); events.abort(); service.close(); section.remove(); sharedSection.remove(); },
  };
}
