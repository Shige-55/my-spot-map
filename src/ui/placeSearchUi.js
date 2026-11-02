import { createPlaceSearchService } from '../services/placeSearchService.js';

export function createPlaceSearchUi({ root, api, mapController, viewTabs, online }) {
  const section = root.querySelector('#place-search'), form = root.querySelector('#place-search-form');
  const input = root.querySelector('#place-query'), submit = root.querySelector('#place-search-submit');
  const status = root.querySelector('#place-search-status'), list = root.querySelector('#place-search-results');
  const service = createPlaceSearchService(api), events = new globalThis.AbortController();
  let available = online, generation = 0, request = null, composing = false;
  section.hidden = false;
  const message = (text) => { status.textContent = text; };
  const clear = () => { list.replaceChildren(); input.value = ''; message(''); mapController.clearSearchLocation(); };
  const suspend = () => {
    generation++; request?.abort(); request = null; submit.disabled = !available; form.removeAttribute('aria-busy'); clear(); section.open = false; section.scrollTop = 0;
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing || event.isComposing || request || !available) return;
    const cycle = ++generation; request = new globalThis.AbortController();
    submit.disabled = true; form.setAttribute('aria-busy', 'true'); list.replaceChildren(); message('検索しています…'); input.blur();
    try {
      const results = await service.search(input.value, request.signal);
      if (cycle !== generation || root.visibilityState === 'hidden') return;
      message(results.length ? `${results.length}件の候補があります。場所を選んでください。` : '見つかりませんでした。市区町村名を添えるなど、検索語を変えてください。');
      for (const result of results) {
        const item = root.createElement('li'), button = root.createElement('button'); button.type = 'button';
        button.textContent = result.label; button.className = 'place-result';
        button.addEventListener('click', () => {
          input.blur(); section.open = false; viewTabs.showMap(); mapController.showSearchLocation(result);
          message('選んだ位置へ移動しました。登録する場合は「地図中心を登録」を押してください。');
          root.querySelector('#register-center').focus({ preventScroll: true });
        }, { signal: events.signal }); item.append(button); list.append(item);
      }
      (results.length ? list : status).scrollIntoView({ block: 'nearest' });
    } catch (error) { if (cycle === generation && error.name !== 'AbortError') { message(error.message); status.scrollIntoView({ block: 'nearest' }); } }
    finally { if (cycle === generation) { request = null; submit.disabled = !available; form.removeAttribute('aria-busy'); } }
  }, { signal: events.signal });
  input.addEventListener('compositionstart', () => { composing = true; }, { signal: events.signal });
  input.addEventListener('compositionend', () => { composing = false; }, { signal: events.signal });
  root.querySelector('#place-search-clear').addEventListener('click', () => { suspend(); section.open = true; input.focus(); }, { signal: events.signal });
  // 閉じる・非表示・利用停止後に古い応答を出さず、検索履歴も残さない。
  section.addEventListener('toggle', () => { if (!section.open) { generation++; request?.abort(); request = null; submit.disabled = !available; form.removeAttribute('aria-busy'); section.scrollTop = 0; } }, { signal: events.signal });
  root.addEventListener('visibilitychange', () => { if (root.visibilityState === 'hidden') suspend(); }, { signal: events.signal });
  window.addEventListener('pagehide', suspend, { signal: events.signal });
  submit.disabled = !available;
  return {
    suspend,
    setOnline(value) { available = value; if (!value) suspend(); submit.disabled = !available || Boolean(request); input.disabled = !available; },
    destroy() { suspend(); events.abort(); section.hidden = true; },
  };
}
