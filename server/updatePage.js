// 壊れた旧シェルからでも開ける公開の復旧画面。認証・アプリ資産・DBの保護は変えない。
export function updatePage() {
  const nonce = globalThis.crypto.randomUUID();
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Spot Map 更新</title>
  <style>body{font:16px/1.8 system-ui,sans-serif;color:#18382e;background:#f7f9f7;margin:0}main{max-width:38rem;margin:8vh auto;padding:24px}button{font:inherit;min-height:44px;padding:12px;background:#155e56;color:white;border:0;border-radius:8px;cursor:pointer}button:disabled{opacity:.5}</style></head>
  <body><main><h1>My Spot Mapの表示を復旧</h1><p>地点データ・パスキーを保持したままアプリを更新します。開いている編集画面があれば、先に保存してください。</p>
  <button id="update" type="button">アプリを更新して開く</button><p id="status" role="status"></p><p><a href="/auth/login">本人確認画面へ</a></p></main>
  <script nonce="${nonce}">
  const button=document.querySelector('#update'),status=document.querySelector('#status');
  button.onclick=async()=>{button.disabled=true;status.textContent='更新を確認しています…';try{
    if(!navigator.serviceWorker)throw new Error('このブラウザは更新処理に対応していません。');
    const registration=await navigator.serviceWorker.getRegistration('/');
    if(!registration){location.replace('/auth/login');return;}
    await registration.update();
    const worker=registration.installing;
    if(worker)await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('更新が完了しませんでした。通信と本人確認を確認して再試行してください。')),20000);
      const changed=()=>{if(worker.state==='installed'){clearTimeout(timeout);resolve();}else if(worker.state==='redundant'){clearTimeout(timeout);reject(new Error('更新資産を取得できません。本人確認画面でログインし直して再試行してください。'));}};
      worker.addEventListener('statechange',changed);changed();
    });
    if(registration.waiting){
      status.textContent='更新版へ切り替えています…';
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('切替を確認できませんでした。このアプリのタブを閉じて、もう一度開いてください。')),15000);
        navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timeout);resolve();},{once:true});
        registration.waiting.postMessage({type:'SKIP_WAITING'});
      });
    }
    location.replace('/');
  }catch(error){status.textContent=error.name==='TypeError'?'更新を取得できません。本人確認画面でログインし直して、このページから再試行してください。':error.message;button.disabled=false;}};
  </script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; connect-src 'self'` } });
}
