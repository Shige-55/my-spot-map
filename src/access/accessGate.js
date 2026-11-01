import { createAccessRepository } from './accessRepository.js';
import { createAccessService } from './accessService.js';
import { createApi } from './api.js';

export function createAccessGate({ root, publicJwk, start }) {
  const panel = root.querySelector('#access-gate');
  const app = root.querySelector('#private-app');
  const message = root.querySelector('#access-message');
  const repository = createAccessRepository();
  const api = createApi();
  const service = createAccessService({ repository, api, publicJwk, origin: window.location.origin });
  const events = new globalThis.AbortController();
  let instance = null, busy = false, stopped = false, lastCheck = 0, modal = null;
  const lock = (text) => {
    instance?.sharing?.suspend();
    modal ||= root.querySelector('dialog[open]'); modal?.close();
    app.hidden = true; app.inert = true; panel.hidden = false; message.textContent = text;
  };
  const unlock = async (member) => {
    if (!member || stopped) return;
    if (!instance) instance = await start({ member, api, accessService: service });
    panel.hidden = true; app.hidden = false; app.inert = false;
    instance?.sharing?.setMember(member);
    if (modal?.isConnected && !modal.open) modal.showModal(); modal = null;
    root.querySelector('#account-status').textContent = `${member.name}（${member.online ? 'オンライン' : 'オフライン'}）／個人機能の利用期限 ${new Date(member.expiresAt).toLocaleString('ja-JP')}`;
  };
  const check = async () => {
    if (busy || stopped || root.visibilityState === 'hidden') return;
    busy = true; lastCheck = window.performance.now();
    try { await unlock(await service.check()); }
    catch (error) { lock(error.message); }
    finally { busy = false; }
  };
  panel.hidden = false; app.hidden = true; app.inert = true;
  root.querySelector('#access-retry').addEventListener('click', check, { signal: events.signal });
  root.querySelector('#access-login').addEventListener('click', () => window.location.assign('/auth/login'), { signal: events.signal });
  root.querySelector('#account-logout').addEventListener('click', async () => {
    instance?.sharing?.suspend(); await service.logout();
    try { await api('logout', { method: 'POST', body: {} }); } catch { /* オフライン中も端末の利用許可は破棄する。 */ }
    lock('ログアウトしました。個人地点は端末内に保持しています。');
  }, { signal: events.signal });
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'hidden') instance?.sharing?.suspend();
    else { lock('利用許可を確認しています…'); void check(); }
  }, { signal: events.signal });
  window.addEventListener('online', check, { signal: events.signal });
  window.addEventListener('offline', () => { instance?.sharing?.suspend(); void check(); }, { signal: events.signal });
  const timer = window.setInterval(() => {
    if (root.visibilityState === 'hidden') return;
    if (window.performance.now() - lastCheck >= 15000) void check();
  }, 1000);
  void check();
  return { destroy() { stopped = true; window.clearInterval(timer); events.abort(); instance?.destroy(); repository.close(); } };
}
