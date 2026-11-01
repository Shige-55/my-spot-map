# 招待制版の配信・運用

2026-11-01。Cloudflare Workers＋D1のFreeプランとパスキーを使う。Zero Trust／Access・カード登録・メール配信・独自ドメインを使わない。GitHub Actionsは検証専用とし、Pages公開のジョブと権限を削除した。

切替記録: 2026-11-01、利用者が管理者登録を操作し、新URLの地図表示とJSON復元を確認した。その後に旧GitHub Pagesを停止し、Pages設定と旧HTML・JS・CSS・SW・manifestの404、新URLの本人確認画面と未認証取得拒否を確認した。端末内の旧DBや登録地点は削除していない。iPhoneの新URLでのホーム画面起動・2端末共有は別途確認する。

## 利用開始と移行

1. 旧URLで「設定→JSONを保存」し、安全な場所へバックアップする。旧URLのDBやホーム画面アプリを消さない。
2. 管理者はローカルの`.secrets/owner-registration.html`から新URLへ進み、端末の案内に従ってパスキーを作る。このファイルは他人へ渡さない。招待は24時間・1回限り。
3. 新URLでJSONを復元し、地点件数、編集、再読み込み後の保持を確認する。originが異なるため旧DBは自動移行されない。
4. 新URLをiPhoneのSafariで開き、ホーム画面へ追加し直す。新しい端末ではパスキーによるログインが必要。iCloudキーチェーン等の同期は端末の設定に従う。
5. 移行確認後に旧GitHub Pagesを停止する。過去に取得されたアプリや公開コードのコピーまで回収することはできない。

## ご自身のiPhoneを追加する（Bluetooth不要）

1. PCで[アプリ更新ページ](https://my-spot-map-private.my-spot-map-shige55.workers.dev/auth/update)から最新版にする。次に[本人確認画面](https://my-spot-map-private.my-spot-map-shige55.workers.dev/auth/login)でパスキーでログインし直す。
2. PCの「設定→アカウント→ご自身のiPhoneを追加」で「iPhone用の登録リンクを作成」を押す。発行にはログインから10分以内が必要。発行したリンクは10分・1回限り。
3. PCに出たQRコードをiPhoneの標準カメラで読み、Safariで開く。これは通常のHTTPSリンクなのでPCのBluetoothは使わない。
4. iPhoneで「このiPhoneにパスキーを登録」を押し、Face ID等で保存する。8桁の確認コードが表示される。
5. 元のPCでそのコードを入力し、「この端末の追加を承認」を押す。承認するまでは新しい鍵でログインできない。
6. iPhoneで「パスキーでログイン」を押す。同じ管理者アカウントで入れる。PCの既存の鍵も保持する。
7. Safariの共有からホーム画面へ追加し、新しいアイコンで必要なら再ログインする。個人地点は端末単位なので、PCのJSONをiPhoneの「ファイル」へ移し、利用するホーム画面版で復元する。

QRやリンクは自分の端末にだけ使用する。リンク・確認コードはチャットや公開場所へ貼らない。作り直すと前のリンクは失効する。元のPCでログアウト・別セッションへ再ログインした場合も、登録リンクを新しく作る。画面を離れるとQRは非表示になるため、必要なら作り直す。家族の利用者招待は次の手順を使う。

## 家族・知人を招待する

管理者の「設定→利用者の招待」で連絡用メールを入力し、表示されたリンクを本人へ直接渡す。メールは自動送信されず、メール所有の確認もしない。相手はリンクでパスキーを作成し、管理者が別の連絡手段で本人の登録を確認して「本人の登録を確認して承認」を押す。その後、相手が「パスキーでログイン」を押すと利用できる。承認前にはアプリ資産やデータを渡さない。

招待を許可しても他人の位置や地点は自動で見えない。利用者同士で共有用IDを伝え、共有申請・承認を行い、地点ごとの共有先を選ぶ。現在地は双方が相互に指定して開始し、前面表示中だけ。復帰しても共有はOFFのまま。

## 無料枠と保存する情報

- Freeプラン: Workersは1日100,000リクエスト、D1は1日500万行読取・10万行書込、アカウントの保存合計5GB。追加の無料DB上限も適用される。上限到達時は処理を停止し、自動で有料プランへ切り替える実装はない。アカウントを有料へ変更しないこと。
- 最新条件は[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)と[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)を参照。事業者の条件変更を永久保証するものではない。
- 非共有の個人地点は端末内。サーバーには連絡用メール、表示名、利用許可、パスキー公開鍵、共有関係、共有を選んだ地点、短期の最新現在地・セッションを保存する。生体情報・パスキー秘密鍵は保存しない。
- 現在地は最新1件を上書きし、有効期限15秒・位置取得から30秒まで。期限切れを読取から除外し、1分周期の処理で削除する。D1のTime Travel等の基盤バックアップには過去内容が残る場合がある。運用基盤の管理権限からも見えない暗号化は提供しない。
- 受信した他人の情報はメモリ内のみ。バックアップJSON・Service Workerに含めない。オンラインで確認した個人機能の署名付き許可は最大24時間。取消は再接続・期限切れ時に反映される。
- 同じブラウザの個人地点DBは端末単位。家族で同じブラウザを共用する場合はOS／ブラウザの別プロフィールを使う。

## 開発・デプロイ

Node.js 24推奨。Windows PowerShellでは`npm.cmd`と`npx.cmd`を使う。`npm.cmd ci`でlockfileを使用する。通常のVite dev／previewだけではWorkerのAPIがなく、認証ゲートを通過できない。既存個人UIの隔離検証は`npm.cmd run dev -- --mode test-public`で行う。認証省略モードのビルドは`.pwa-test/`内にしか生成できず、本番のdistへ出力すると失敗する。

本番の設定は`wrangler.example.jsonc`から`wrangler.local.jsonc`を作り、account_id、D1 database_id、APP_ORIGINを指定する。個人情報・鍵・実IDを含むローカル設定はGitへ含めない。

```powershell
npm.cmd run create:offline-key
npx.cmd wrangler login
npx.cmd wrangler d1 migrations apply my-spot-map-private --config wrangler.local.jsonc --remote
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run verify:dist
npm.cmd run check:private
npm.cmd run deploy:private
```

`create:offline-key`は既存鍵を上書きしない。`.secrets/setup.json`の`ownerEmail`に管理者の連絡用メールを非公開で設定し、`SESSION_SECRET`（乱数32バイトの64桁hex）と`OFFLINE_PRIVATE_JWK`をWranglerのsecretへ設定する。これらをVITE_変数に入れない。公開側に置くのはオフライン検証用の公開鍵だけ。

所有者初期化: `node scripts/prepare-owner.js`の後、`npx.cmd wrangler d1 execute my-spot-map-private --config wrangler.local.jsonc --remote --file .secrets/owner-registration.sql`を実行し、生成したHTMLから本人が登録する。所有者はDBの制約で1人、再実行時は重複作成しない。実トークンをターミナル出力やチャットに貼らない。

ローカルのWorker検証は`.dev.vars`へ架空データ用の秘密値を設定し、APP_ORIGINを`http://localhost:8787`へ上書きする。`VITE_OFFLINE_PUBLIC_JWK`に対応するテスト公開鍵を指定してbuildし、`dev:private`を実行する。テスト鍵のbuildを本番へ配信しない（`check:private`が本番鍵との不一致を拒否する）。本番鍵・実ユーザーDBをテストへ使わない。`test:private`はポート4180・インメモリSQLite・一時鍵・ブラウザ仮想パスキーで隔離した本番ビルドを検証する。`npm test`にこの検証も含める。

すべての資産に`run_worker_first: true`、プレビューURLは無効、Workerのアプリログは無効。未設定・DB障害時も公開へ切り替えない。配信前に`check:private`で検査する。秘密ファイル、個人バックアップ、D1エクスポートをGitへ追加しない。公開リポジトリには架空データだけを使う。

## パスキー紛失・利用取消

ログイン直後に`ERR_FAILED`で地図を開けない場合は、パスキーを使ったのと同じブラウザで[アプリ更新ページ](https://my-spot-map-private.my-spot-map-shige55.workers.dev/auth/update)を開き、「アプリを更新して開く」を押す。保存中の編集は先に保存する。これはService Workerだけを更新し、地点DB・パスキー・Cookieを削除しない復旧操作。更新の本人確認を求められた場合は、本人確認画面でログイン後、このページから再試行する。

- 紛失前に「追加のパスキーを登録」で別の保存先／端末の鍵を用意する。10分以内のログインが必要、最大5個。同じ認証器に同じ利用者の鍵を重複作成しない。
- 一般利用者の紛失時は管理者が「利用を停止」を行い、本人を確認して再招待する。古い鍵・セッション・共有関係は無効化される。個人DBは消さない。
- 管理者自身が全パスキーを失ったときだけ、CloudflareにCLIで認証して`node scripts/prepare-owner.js --recover-owner`を実行し、生成したSQLを上記と同様に適用する。古い管理者鍵・セッションをすべて無効にし、HTMLから登録し直す。これは通常の追加パスキー操作と異なる復旧操作。
- ログアウトはこの端末の許可とサーバーセッションを破棄する。オフライン中はセッションIDを端末で拒否し、接続復帰時に古いCookieから勝手に再ログインしない。
- サーバー上の登録地点の共有はログアウトだけでは解除しない。停止したい場合は先に共有解除の成功を確認する。

## 実機で必要な確認

新URLでiPhoneのパスキー登録・ログイン・ホーム画面起動・オフライン再起動、期限後／取消後のロック、既存JSON復元、2台の前面現在地共有・ロック時停止・復帰時OFF、地点共有と解除を確認する。ブラウザの自動テストをiPhone実機の確認済みとは扱わない。
