# My Spot Map 技術設計

## 構成
UI → アプリサービス → SpotRepository → Dexie → IndexedDB。
Leafletは地図描画と操作のみを担当。UIからDexieを直接呼ばない。初期版はVanilla JavaScript + Viteを採用し、大規模フレームワークやバックエンドは導入しない。

## 推奨ファイル構成（実装時に作成）
```text
index.html
package.json / package-lock.json
vite.config.js
public/icons/                  # PWA・Apple touch icon
src/main.js
src/styles.css
src/map/mapController.js        # Leaflet、長押し、現在地
src/ui/                        # 一覧、フォーム、設定
src/services/spotService.js
src/services/backupService.js
src/domain/spot.js              # 検証、検索正規化
src/repositories/spotRepository.js
src/db/database.js
src/pwa/                       # 更新通知
tests/
.github/workflows/deploy.yml
```
第5段階では標準Service Worker APIとViteのビルド拡張でPWAを実装し、追加依存を使わない。地図、DB、地点操作、検索・カテゴリ・長押し・現在地、JSONバックアップと復元、PWAと検証環境を作成済み。第6段階で公開先設定とGitHub Actionsを作成済み。実際のpush・Pages設定変更・公開・HTTPS／iPhone実機確認は未実施。

### 第1段階の実装
- `src/config.js`: 初期座標、zoom、タイルURL、帰属表示を集約。
- `src/map/mapController.js`: Leafletの生成、操作、タイル通信エラー表示、再描画と破棄。
- `src/ui/viewTabs.js`: タブ選択・キーボード操作・レスポンシブ表示。表示状態はメモリ内のみ。
- `src/main.js`: UIと地図の組み立て。Viteの更新時にイベントと地図を破棄。
- 幅768px以上は左に登録地点・右に地図を常時表示。未満は地図／登録地点タブで切り替え。空一覧には登録機能の準備中表示を出す。
- タブを開いた後とResizeObserverによる地図領域変更時に、次の描画フレームで`invalidateSize`を実行する。第2段階で`{ pan: true, animate: false }`に調整し、地図中心を保つ。Leaflet標準のウィンドウresize監視は無効化し、非表示中のサイズ0で地図が更新されることを防ぐ。
- `100dvh`とセーフエリアの余白を使用。Leafletのズームボタンを44px以上にし、日本語ラベルを付ける。
- 本番ビルドはSafari 16.4以降を対象に含める。iPhone実機での動作保証は後続の受け入れ確認で行う。
- `npm test`はこの段階のPlaywright画面テスト。Vitestとfake-indexeddbは、検証・保存処理を実装する段階で追加する。

### 第2段階の実装
- `src/db/database.js`: DexieによるDBファクトリーとversion 1の宣言。既存DBを削除・再生成するリカバリー処理は設けない。
- `src/domain/spot.js`: 名前・メモ・カテゴリ・座標・zoomの型、範囲、コードポイント文字数を検証。検証エラーと未存在エラーを定義。
- `src/repositories/spotRepository.js`: `list/get/create/update/softDelete`を実装。編集と削除は読取から書込まで同一transaction。成功Promiseはコミット後に解決。UUIDとUTC日時を生成し、編集は許可項目だけを受け付ける。日時は端末時計が戻っても直前のupdatedAtより1ms以上進める。
- `src/services/spotService.js`: Repositoryを呼び出し、保存・読込・削除失敗を日本語化。再試行時はDBを開き直せるようにする。
- `src/ui/spotApp.js`: 表示データと選択IDを保持し、サービスの保存成功後に一覧・マーカーを更新。`spotList.js`と`spotForm.js`が一覧とフォームを担当し、UIはDexieを直接操作しない。
- 地図中心の目印と「地図中心を登録」から、名前・メモ・緯度・経度のフォームを開く。保存するzoomは登録時の地図倍率。編集時は元のzoomとカテゴリを保持。カテゴリ入力は第3段階で追加する。
- 一覧は更新日時降順・同時刻ID順。地点選択で保存位置とzoomへ移動し、一覧とマーカーを強調する。iPhone幅では地図タブへ切り替える。ズームアニメーション中の選択は終了後に最後の選択を反映する。
- 保存失敗はダイアログと入力を保持し、再試行可能。フォームと削除確認は処理中の重複送信・キャンセルを防ぐ。削除は確認後にdeletedAtを設定し、レコードを残す。
- native dialogでフォーカスを管理。キャンセル／Escape時にDBは変更しない。未保存の編集がある場合はページ再読み込み・離脱時にブラウザの確認を要求する（OSによる強制終了を防ぐものではない）。
- バックアップ用の`exportAll/replaceAll`と検索条件は後続段階で実装する。第2段階ではクラウド同期・PWA・Service Workerを導入しない。
- `npm test`はVitest + fake-indexeddbの単体テストとPlaywrightの画面テストを連続実行。移行テストは架空の旧スキーマを用い、索引追加時の既存データ保持と異常時のロールバックを検証する。

### 第3段階の実装
- `src/domain/spot.js`の`normalizeSearch/filterSpots`でNFKC・前後空白除去・英字大小無視の名前／メモ部分一致とカテゴリ完全一致をANDで適用。有効地点だけを更新日時降順・同時刻ID順で返す。Repositoryの`list({query, category})`と、サービス経由の画面内絞り込みが同じ関数を使う。
- 画面は全有効地点を読み込んで保持し、入力のたびにローカルで絞り込み、同じ結果を一覧とマーカーに渡す。カテゴリ候補は検索結果に限定せず全有効地点から生成する。日本語IME変換中の検索更新は待ち、確定後に反映。検索条件はメモリ内で保持し、再読み込み時は解除する。
- `src/ui/spotFilters.js`: 検索・カテゴリ・解除操作。未分類は保存値の空文字、全カテゴリはnullで区別する。select値はJSON文字列として符号化し、任意のカテゴリ名と全件選択用の値を衝突させない。ユーザーがカテゴリ名「未分類」を付けた場合も未設定とは別の選択肢にする。
- 地点フォームにカテゴリ入力とdatalistによる既存値候補を追加。任意文字列1つ、trim後50コードポイントまで。未入力は空文字で保存し、一覧では「未分類」と表示。DB version 1の既存フィールドを使用するため、スキーマ変更・既存データの書き換えはない。
- 条件から外れた選択は解除し、0件時は未登録と検索該当なしを区別。編集中にカテゴリ等を変え、保存後に条件から外れた場合は絞り込みを保ち、その旨を案内する。
- `src/map/longPressGesture.js`: DOM非依存の600msタイマーとポインター状態。移動10px超、pointerup/cancel、複数指で解除。すべての指を離すまでは再開始せず、1ジェスチャーで1回だけ通知。
- `src/map/mapRegistration.js`: 地図内から始まった操作だけを候補にし、コントロール・既存マーカーからの操作を除外。地図ドラッグ／移動／ズーム、領域外移動、キャプチャ喪失、非表示化／画面離脱でも解除する。地図外の2本目の指も監視する。長押しとPC右クリックは共通の登録フォームへ座標とzoomを渡し、保存操作まではDBを書かない。
- LeafletのtapHoldを無効化。タッチ／ペン由来のcontextmenuは抑止し、互換マウスイベントも接触終了後1秒間は抑止する。フォームが開いているときの再登録は入力を初期化しない。地図のドラッグ／ピンチに必要なpointerイベント自体は妨げない。
- `src/services/geolocationService.js`: ボタン操作でgetCurrentPositionを1回だけ呼ぶ。最大10秒・キャッシュ再利用なし。拒否・取得不可・非対応・HTTPS不足・タイムアウトを日本語で案内。独自の待機期限を超えた応答は無視し、継続追跡や保存はしない。
- 地図は現在地の青い専用マーカーとメートル単位の精度円を別LayerGroupに表示し、再取得時に置換。登録地点の絞り込み・選択・削除と独立させ、再読み込みで消す。位置情報は独自サーバーへ送信しないが、移動先の地図タイルは通常どおりOSMから読み込む。
- 追加依存なし。バックアップ、PWA、同期、公開処理はこの段階では追加しない。

### 第4段階の実装
- `src/domain/backup.js`: JSONの構造、バージョン、全レコード、件数・バイト数、UUIDとUTC日時の検証。既知フィールドから新しいオブジェクトを作り、未知フィールドやプロトタイプを引き継がない。
- `src/services/backupService.js`: 全件書き出し、UTF-8ファイル読み込み、検証済み復元計画、明示確認、書込エラーの日本語化を担当。確認用にはファイル名・書き出し日時・現在と取り込み後の件数だけを渡し、検証済みレコードとDBのスナップショットをWeakMap内に保持する。
- Repositoryに`exportAll`と`replaceAll`を追加。書き出しはreadonly transaction、置換は読取・確認後の変更検出・clear・bulkAddを単一readwrite transactionで実行。bulkAddのエラーをtransaction内で握りつぶさず、全体をロールバックする。Repositoryでも全件を再検証してからclearへ進む。
- `src/ui/backupSettings.js`: ヘッダーの「設定」からダイアログを開き、保存説明、JSONダウンロード、ファイル選択・検証、件数、全件置換の説明、確認チェックを表示。ファイル選択や検証だけではDBを変更しない。閉じる・Escape・復元キャンセル・選び直しで古い復元計画を破棄する。
- 書込失敗時は確認内容を残して再試行可能。確認後に別タブ等から保存内容が変わった場合は置換せず、計画を破棄して再検証を求める。処理中は重複操作と閉じる操作を無効化し、ページ離脱にはブラウザの確認を要求する。
- 成功時だけ画面に復元結果を渡す。再読込の成功に依存せず、一覧・マーカー・カテゴリ候補を更新し、検索条件と選択を解除する。現在地表示はバックアップや復元対象に含めない。
- バックアップのBlob URLは再ダウンロード用リンクにも使い、作り直し・設定を閉じる・画面の破棄時に解放する。ブラウザがダウンロードを開始した時点で案内し、保存先にファイルが存在するかは利用者に確認してもらう。
- 追加依存・DBスキーマ変更なし。PWA、クラウド同期、公開処理は追加しない。

### 第5段階の実装
- `public/manifest.webmanifest`と`public/icons/`を追加。manifestのid/start_url/scopeは`./`でmanifest配置先と一致。192px／512pxの通常アイコン、512px maskable、180px Apple touch icon、SVGを同梱する。マーカーと同じピンの形を使い、maskableの重要部分は中央の安全領域内に収める。
- `build/pwaPlugin.js`: Vite build時にHTML・JS・CSS等の出力と既知の公開アイコン・manifestを列挙。内容とbase、Workerのソースからバージョンを生成し、indexのapp-versionとsw.jsへ埋め込む。利用者のJSON・外部URL・地図タイルを事前キャッシュへ追加しない。
- baseは`/`または`/リポジトリ名/`形式。HTMLのmanifest／アイコンリンク、Service Worker登録URLとscope、事前キャッシュURLはすべて同じVite baseを使う。ビルド時にbaseが同一origin内の絶対パスであることを確認する。実公開先は第6段階で確定する。
- `src/pwa/service-worker.js`: installで列挙済みの静的資産だけをCacheStorageへ保存。更新版はwaitingで待ち、同じscopeのクライアントからSKIP_WAITINGを受け取った場合だけ即時有効化する。初回登録では標準のライフサイクルで有効化する。
- fetchは同一origin・GET・列挙済みURLだけを処理し、アプリのルート／index.htmlへのナビゲーションはキャッシュ済みHTMLを返す。外部OSMタイル、未知のパス、利用者のJSON、POSTは横取りせず、実行時のタイルキャッシュも設けない。固定の公開資産は配信側の`Vary: Origin`差で参照が外れないよう`ignoreVary`を使う。
- キャッシュ名をbase別の名前空間と内容バージョンで分ける。install失敗時は新キャッシュだけを削除し、旧版を維持。activate時は同じbaseの旧シェルだけを整理し、他のscopeのキャッシュとIndexedDBに触れない。
- `src/pwa/pwaManager.js`: Worker登録、待機版・有効版の検出、利用者の同意、切替タイムアウトを担当。初回・別タブの更新だけでは再読み込みしない。表示中のHTMLバージョンとWorkerのバージョンも照合する。
- `src/pwa/pwaUi.js`: 下部の更新通知、設定の準備状態と手動更新確認、オフライン案内。登録は本番ビルドの安全なコンテキストのみ。開発サーバーでは登録せず、キャッシュや既存DBの削除も行わない。オンライン復帰・画面復帰時は最短60秒間隔で更新を確認する。
- フォーム・設定・削除確認のダイアログ、保存・復元等の処理中、初期DB読込中は更新操作を無効化。利用者の「更新する」の操作後にも、controllerchange時に再確認してからreloadする。その間に入力を始めた場合は入力を保持し、改めて更新操作を待つ。別タブでWorkerが有効化されても同じ入力保護を行う。
- オフライン時は背景地図の制限を説明し、地図の重複エラー案内を抑える。一覧・検索・登録・編集・削除・JSON書き出し／復元は既存のIndexedDBとクライアント処理を使う。
- `playwright.pwa.config.js`と`tests/pwa/`で、ルートとサブパス、新旧ビルド、取得失敗、実際のVite previewを配信して検証する。検証専用の切替エンドポイントは製品に含めない。生成物は`.pwa-test/`に置きGitとlintの対象外にする。

## DB
DB名: my-spot-map / version 1 / spotsテーブル。
Dexieのstores定義案: `spots: 'id, updatedAt, category'`。deletedAtのnullはIndexedDBキーとして索引に頼らず、Repositoryで除外する。

| フィールド | 型・意味 |
|---|---|
| id | UUID文字列、主キー、変更不可 |
| name | 地点名 |
| latitude / longitude | 有限数の緯度／経度 |
| zoom | 登録時の整数zoom |
| memo | メモ、既定空文字 |
| category | カテゴリ、既定空文字 |
| createdAt / updatedAt | UTC ISO 8601文字列 |
| deletedAt | UTC日時またはnull（有効） |
| syncStatus | pending / synced。初期版は全レコードpendingでUI非表示 |

create/update/deleteではupdatedAtを更新しpendingにする。deleteはdeletedAtも設定して記録を残す。UIには有効な地点だけ返す。初期版で墓石レコードを自動削除しない。DB変更はDexieのversion migrationで既存データを保護する。

## Repositoryの契約
全メソッドはPromise。UIは戻り値のコピーを使う。
- list({query, category}): 有効地点を絞り込み、updatedAt降順・同時刻はid順。
- get(id): 有効地点またはnull。
- create(input): 検証、UUID/日時生成後に保存。
- update(id, patch): 編集可能フィールドだけ受け付け、未存在・削除済みはエラー。
- softDelete(id): 削除記録を保存。
- exportAll(): 削除済みを含む全件。
- replaceAll(validatedSpots): 単一readwrite transactionでclear + bulkAdd。途中失敗はロールバック。
検索は日本語の分かち書きや外部APIを使わず、正規化したname/memoの部分一致。初期想定1000件で基本操作を実機確認する。

## 地図と画面状態
選択ID、検索条件、表示タブ、地図中心をアプリ状態で保持。登録データと現在地マーカーは別管理。未保存フォームをタブ移動や更新で失わない。
長押しはpointerイベントで600ms、移動10 CSS px超・pointercancel・地図ドラッグ・複数指で解除し、フォームを1回だけ開く。タッチ端末でcontextmenuとの二重発火を防ぐ。タブ表示／画面サイズ変更後にLeaflet invalidateSizeを実行。
ユーザー入力はtextContent等で描画し、ポップアップへ未加工HTMLを渡さない。

## JSON形式と復元
```json
{
  "app": "MySpotMap",
  "schemaVersion": 1,
  "exportedAt": "2026-10-31T12:00:00.000Z",
  "spots": []
}
```
spotsの各要素は上記DBの全フィールドを持つ。UTF-8 JSONをBlobとしてダウンロードし、ファイル名はmy-spot-map-backup-日時.json。
初期版は「全件置換」のみ。最大10MiB・10000件を上限とし、JSON構造、app、バージョン、必須型、入力上限、座標、UUID形式、日時、日時前後関係、重複ID、syncStatus列挙を全件検証。未知バージョンは拒否し、未知フィールドは取り込まない。検証済み項目から新しいオブジェクトを組み立てる。
置換前に現DBのバックアップ取得を案内し、有効件数・削除件数と置換内容を表示。キャンセルなら無変更。同期先未設定の復元ではsyncStatusをpendingへ正規化し、ID・日時・削除記録は保持。処理中は重複操作を防ぐ。読み込み・検証・transaction失敗を分けて表示する。

第4段階の検証規則:
- 復元上限の10MiBはUTF-8の実バイト数（10 × 1024 × 1024）、件数は削除記録を含む。ファイルサイズを読み込み前に確認し、不正UTF-8をTextDecoderのfatalモードで拒否する。UTF-8 BOMは受け付ける。
- UUIDはRFCバリアントのversion 1〜8を受け付け、英字の大小だけ異なるIDも重複として拒否する。単独のIDの表記は保持する。
- 日時はこのアプリが書き出すtoISOString形式、`YYYY-MM-DDTHH:mm:ss.sssZ`に限定し、実在日付も検証。createdAt ≤ updatedAt、削除済みはcreatedAt ≤ deletedAt ≤ updatedAtとする。端末時計のずれや更新日時の単調増加を考慮し、updatedAt ≤ exportedAtや現在時刻より前であることは要求しない。
- 名前・メモ・カテゴリ・座標・zoomを含む全フィールドを必須とする。入力規則は地点フォームと共通。名前・カテゴリのtrimはフォームと同じで、その他の既知フィールドはUUID・日時を含め保持する。syncStatusはpending/synced以外を拒否し、復元時はpendingにする。
- 空配列も有効なバックアップ。全件がなくなることを追加表示し、同じ明示確認後にだけ置換する。
- 書き出しは復元上限を超えても全地点を含める。その場合は現在の復元上限を超える旨を案内する。復元時の上限は緩和しない。
- 復元計画は検証結果そのものを外から改変できない形で保持し、同じ計画の二重実行やキャンセル後の利用を拒否する。確認後の保存変更を単一transaction内で検出するため、確認済み件数が同じでも内容が変わっていれば再検証する。

## PWA・配信
manifest: name My Spot Map / short_name MySpotMap / display standalone。192/512pxアイコン、maskableアイコン、apple-touch-iconを用意する。
GitHub Pagesのプロジェクト公開ではVite baseを実際のリポジトリ名に合わせる。start_url、scope、Service Worker、アイコン、Leafletマーカー画像のパスも同じbaseを使う。クライアントルーターは初期版で使わない。
Service Workerはアプリシェルの同一originビルド資産のみ事前キャッシュ。外部OSMタイルは対象外、標準ブラウザHTTPキャッシュに任せる。タイル一括取得やオフライン地図ダウンロードは実装しない。
更新時は通知し、編集中は即時reloadしない。ユーザーの更新操作後に切替。旧シェルキャッシュの整理でIndexedDBを消さない。開発時のSWは原則無効、npm run build / previewで確認。
HTTPSのPagesで現在地・Service Workerを確認。iPhoneからPCのHTTP LAN URLを開く方法だけでは本番相当の確認にならない。

第5段階ではrootと`/pwa-check/`のローカルビルドで整合性とオフライン動作を検証済み。HTTPSでの公開とiPhone実機Safari／ホーム画面起動は第6段階以降の受け入れ確認として未確認のまま記録する。開発用とpreviewでoriginが異なる場合の地点移行はJSONで行う。

### 第6段階の配信設計
- 利用者指定の`Shige-55/my-spot-map`・`main`を`pages.config.json`に保持。`build/pagesConfig.js`で値を検証し、Vite build／previewのbaseを`/my-spot-map/`へ決定する。devは`/`を維持。GitHub上の既定ブランチやPages設定は未認証では取得できず、利用者指定を根拠に設定した。
- `.github/workflows/deploy.yml`はmainへのpush／PRで検証し、mainの手動実行だけが配信する。手動時は実行リポジトリ・refと設定の一致を検証。Ubuntu 24.04・Node.js 24・Chromiumでlockfileによるnpm ci、lint、全テスト、build、verify:distを実行する。
- 検証ジョブはcontents readだけ。公開ジョブはpages write／id-token writeだけで、ソースのcheckoutは行わず検証済みdistをPagesへ配信する。公式ActionsをリリースのコミットSHAに固定し、checkoutの資格情報保持を無効化。Pagesの自動有効化はせず、設定のbase_pathとビルドbaseが異なれば配信を停止する。
- `build/verifyPagesBuild.js`で許可された静的資産だけが出力されていること、SWのキャッシュ対象と出力の一致、HTML／manifest／アイコンとbase・版・寸法の整合を確認。余分なJSON・秘密ファイル・シンボリックリンクを拒否する。OSMタイル・利用者DB・バックアップを公開対象に含めない。
- ローカルGitのoriginとmainを設定済みだがコミット・push・公開は未実施。実際の公開には追加の操作依頼が必要。想定URLは`https://shige-55.github.io/my-spot-map/`。独自ドメインは対象外。
- root／検証用サブパスに加えて実公開baseのビルドと実Vite previewでPWAを検証。異なるbaseや余分なJSONの拒否も検証する。GitHub上のCIとHTTPS／実機の受け入れ結果は別途記録する。

## OpenStreetMap
タイルURLは設定へ集約: https://tile.openstreetmap.org/{z}/{x}/{y}.png 。常時見える「© OpenStreetMap contributors」とhttps://www.openstreetmap.org/copyrightへのリンクを表示。Refererを妨げる設定やキャッシュ回避をしない。可用性保証はないためエラー時も保存済み一覧を提供する。

## 将来のPC同期（未実装）
Repositoryの外にSyncServiceとクラウドアダプターを追加。Supabaseは候補であり確定依存にしない。導入時に認証、ownerId、RLS、サーバーrevision、変更カーソル、outbox、再試行を設計する。公開クライアントに管理キーを置かない。
UUIDとdeletedAtを保ち、ローカル更新と送信待ち記録を同一transactionへ追加する移行を行う。pull/pushは冪等とし、同期成功前にpendingを解除しない。端末時刻のupdatedAtだけで競合を上書きしない。revision不一致時は両案を保持して利用者に選択させる方針。削除伝播確認前に墓石を消さない。復元と同期の扱いは同期導入時に再設計する。

## 検証
Vitest + fake-indexeddbで検証・検索・Repository永続化・論理削除・復元の原子性を確認。Playwrightで登録→一覧選択→編集→削除、再読み込み、JSON往復と不正復元時の無変更を確認。タイル・位置情報は自動テストでモックし、実タイルやiPhone操作は別途手動確認。

## 公式参照先
- Leaflet: https://leafletjs.com/reference.html
- Dexie: https://dexie.org/docs/
- Vite / Pages: https://vite.dev/guide/static-deploy.html
- OSMタイル方針: https://operations.osmfoundation.org/policies/tiles/
- PWA: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
