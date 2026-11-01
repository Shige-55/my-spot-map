export function loginPage({ adding = false } = {}) {
  const nonce = globalThis.crypto.randomUUID();
  const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Spot Map 本人確認</title>
  <style>body{font:16px/1.8 system-ui,sans-serif;color:#18382e;background:#f7f9f7;margin:0}main{max-width:38rem;margin:10vh auto;padding:24px}button,input{font:inherit;padding:12px;min-height:44px;box-sizing:border-box}button{background:#155e56;color:white;border:0;border-radius:8px;cursor:pointer;margin:8px 4px}button:disabled{opacity:.5}input{width:100%;border:1px solid #9bb8aa;border-radius:6px}label{display:block;margin-top:16px}h1{color:#155e56}</style></head>
  <body><main><h1>My Spot Map</h1><p>管理者と招待・承認された利用者専用です。</p>
  <button id="login" type="button" ${adding ? 'hidden' : ''}>パスキーでログイン</button><hr>
  <div ${adding ? 'hidden' : ''}><label for="invitation">招待コード</label><input id="invitation" autocomplete="off" type="text"></div>
  <button id="register" type="button">${adding ? '追加のパスキーを登録' : '招待を受けてパスキーを登録'}</button>
  <p>${adding ? '復旧に備えて別の端末や保存先のパスキーを追加できます。' : '招待リンクは他人へ転送しないでください。登録後は管理者の承認が必要です。メールアドレスの所有確認は行いません。管理者が本人の登録を確認します。カード情報は使用しません。'}</p>
  <p id="status" role="status"></p><p>個人地点は端末内に保持しています。</p><p><a href="/auth/update">ログイン後に画面が開かない場合はアプリを更新</a></p></main>
  <script nonce="${nonce}">
  const status=document.querySelector('#status'),token=document.querySelector('#invitation');
  const adding=${adding};
  token.value=new URLSearchParams(location.hash.slice(1)).get('invite')||'';if(location.hash)history.replaceState(null,'',location.pathname);
  const decode=(value)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const encode=(buffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  async function api(path,body){const response=await fetch('/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin',redirect:'error'});const value=await response.json();if(!response.ok)throw new Error(value.message||'本人確認できません。');return value;}
  async function act(register){document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='端末で本人確認してください…';try{
    if(!window.PublicKeyCredential)throw new Error('この端末はパスキーに対応していません。対応するSafariやChrome、Edgeで開いてください。');
    const route=register?(adding?'keys':'register'):'login';
    const result=await api(route+'/options',register?{token:token.value.trim()}:{}),options=result.options;
    options.challenge=decode(options.challenge);
    if(register){options.user.id=decode(options.user.id);options.excludeCredentials?.forEach(c=>c.id=decode(c.id));}else options.allowCredentials?.forEach(c=>c.id=decode(c.id));
    const credential=await navigator.credentials[register?'create':'get']({publicKey:options});if(!credential)throw new Error('本人確認を完了できませんでした。');
    const output={id:credential.id,rawId:encode(credential.rawId),type:credential.type,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:encode(credential.response.clientDataJSON)}};
    if(register){output.response.attestationObject=encode(credential.response.attestationObject);output.response.transports=credential.response.getTransports?.()||[];}else{output.response.authenticatorData=encode(credential.response.authenticatorData);output.response.signature=encode(credential.response.signature);output.response.userHandle=credential.response.userHandle?encode(credential.response.userHandle):null;}
    const verified=await api(route+'/verify',{challengeId:result.challengeId,response:output});
    if(verified.pending){token.value='';status.textContent='パスキーを登録しました。管理者の承認後に「パスキーでログイン」を押してください。';}else location.replace('/');
  }catch(error){status.textContent=error.name==='NotAllowedError'?'本人確認を完了できませんでした。パスキーと端末の設定を確認してください。':error.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  document.querySelector('#login').onclick=()=>act(false);document.querySelector('#register').onclick=()=>act(true);
  </script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` } });
}
