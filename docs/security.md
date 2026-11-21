# セキュリティ・権限・プライバシー

この拡張は非公式で、NovelAIと提携していません。脆弱性の報告方法はルートの [SECURITY.md](../SECURITY.md)、利用者向けのプライバシー方針は [PRIVACY.md](../PRIVACY.md) を参照してください。

## 原則

- **NovelAIの利用規約が最優先**: このリポジトリの要件・機能・文書とNovelAIの[利用規約](https://novelai.net/terms)（その他の公式ルールを含む）が食い違う場合は、常に規約に従います。規約に反するおそれがある、または適用がはっきりしない機能は実装・有効化せず、無効のまま理由を記録します。規約の改定で禁止された機能は無効化・削除します。
- **ローカル専用**: データはChromeプロファイルのIndexedDBだけに保存します。同期・テレメトリ・クラッシュ送信・外部API呼出し・CDNはありません。画像やプロンプトを外部に送信しません。
- **生成しない**: プロンプト文字列を作るだけで、生成ボタンを押さない・自動連続生成しない・非公開APIを呼ばない・課金操作をしない。自動シャッフルもプロンプト欄の書換えだけで、生成はユーザーが行います。
- **認証情報に触れない**: Cookie・トークン・セッション・認証情報を読取り・記録・保存しません。
- **未検証のサイト構造に書き込まない**: 製品の `LiveReadOnlyAdapter` は読取り専用です。推測したセレクタを追加しません（[DOM_ADAPTER_CHECKLIST.md](DOM_ADAPTER_CHECKLIST.md)）。

## NovelAI利用規約との関係

確認した文書: NovelAI Terms of Service（https://novelai.net/terms 、"Effective: December 8th, 2025"）。2026-11-18に確認し、2026-11-21に再確認（施行日・下記の条項番号とも変更なし、拡張機能への言及なし）。法的助言ではなく、条文の読み取りです。

**結論: 規約はブラウザ拡張機能・ユーザースクリプト・非公式ツールを明示的に許可も禁止もしていません（言及なし）。** 公式に認められた拡張機能ではありません。関係しうる条項と、この拡張の対応は次のとおりです。

| 条項（要旨） | この拡張 |
|---|---|
| 9.1.6 制限を守らない自動化システム・ボットネットの使用、サービスへの過度な負荷の禁止 | NovelAIへのリクエスト（API呼出し・生成）を一切送らない。生成の自動実行・連続生成をしない。自動シャッフルも入力欄の書換えだけ（実サイトでは無効） |
| 9.1.4 許可されていない・サポートされない方法でのアクセスの禁止 | ページの入力欄を読み取るだけで、ログイン・通信・非公開APIに関与しない。ただし「サポートされない方法」の範囲は規約上明確でない |
| 5.3.3 / 5.3.4 / 9.1.5 アクセス制御・保護手段の回避、回避する製品の開発・配布の禁止 | 認証・課金・利用制限・保護手段に触れない |
| 8.1 / 5.3.2 / 9.1.3 アカウント情報の共有・第三者の遠隔アクセスの禁止 | Cookie・トークン・認証情報を読まない・保存しない・送らない |
| 9.1.2 サービスの複製・改変・ホスティング・再販の禁止 | NovelAIのサービスやコンテンツを複製・配布しない |
| 7.2 商標等の権利は付与されない | 名称は識別目的のみ。ロゴ・意匠を使わず「非公式」「提携なし」を明記 |

NovelAIは公式にユーザースクリプト機能（ストーリー機能向け、https://docs.novelai.net/ja/scripting/introduction ）を提供していますが、外部のブラウザ拡張についての言及ではありません。

運用方針（いずれもNovelAIの利用規約を優先する前提）:

- 現在の機能（ローカル保存・読取り・コピー）は上記の禁止事項に該当しない設計を維持する。
- **実サイトへの書込み・自動シャッフルの実サイト対応・生成の自動化は、規約上の扱いが明確でないため無効のまま**とし、有効化を検討する場合は事前にNovelAIサポートへ確認する。
- Chrome Web Storeで一般公開する前に、NovelAIサポートへ拡張機能の公開について問い合わせることを推奨する（[release-checklist.md](release-checklist.md)）。
- 規約は改定されうるため、リリースごとに再確認して日付を更新する。

## 権限（manifest）

| 項目 | 値 | 理由 |
|---|---|---|
| `permissions` | `sidePanel` のみ | サイドパネル表示とツールバーから開く動作 |
| `host_permissions` | なし | content scriptは静的宣言のみ |
| content script | `https://novelai.net/image`, `/image?*`, `/image/*`、ISOLATED world、トップフレームのみ応答 | 画像生成ページのプロンプト欄の読取り |
| background | `background.js`（`sidePanel.setPanelBehavior` の呼出しだけ） | ツールバーボタンでサイドパネルを開く。状態・通信・タブ参照なし |

`tabs`・`activeTab`・`storage`・`cookies`・`webRequest`・`scripting`・`<all_urls>` は要求しません。タブ一覧はIDだけを取得し（`tabs.query` は権限なしではURL・タイトルを返さない）、URL・タイトルは対象ページのcontent scriptが自己申告します。

## サイトとのメッセージ（`src/platform/novelai/`）

- 型付きプロトコル `nai-prompt-workbench/site-v1`。要求・応答とも厳密な形・長さ・件数で検証し、余分なキーを拒否します。
- 受信側は送信元を検証します: 拡張ID一致、送信元URLが自拡張の `sidepanel.html`（`#lab` 等のフラグメント・クエリのみ違いを許容）、`sender.tab` なし（他サイトのcontent scriptからの送信を拒否）。
- 要求は `tabId`・`documentId`（content script起動ごとの乱数）・URLで対象ページを固定し、再読込・移動後の要求は `STALE_DOCUMENT` で拒否します。
- 書込みは「プレビュー → 確認 → 60秒・1回限りのチケット → 書込み前に全欄のcompare-and-swap → 書込み → 再読取りで一致確認」。途中失敗時は自分が書いた未変更の欄だけを戻します。書込み開始後の失敗は必ず `WRITE_FAILED` として返し、パネルはその欄を「状態不明」として次回の上書きに明示同意を求めます。
- 反映前原文・最後の書込み内容は（タブ・ドキュメント・プロファイル）単位でパネルのメモリにだけ保持し、別の対象へは反映しません。
- 生成状態の監視は自動シャッフルのlease（15秒）中だけ動作し、パネル1つに限定します。

## 取込データの扱い

JSON・完全バックアップZIP・PNG・Lab JSONは**信頼できない入力**として扱います。

- サイズ・件数・深さ上限、`__proto__`/`constructor`/`prototype` キー拒否、循環・非JSON値の拒否、ID形式・重複・参照整合性の検証。
- PNG: 署名・チャンク境界・CRC・終端・寸法・画素数・テキストチャンクの展開後サイズ（圧縮爆弾対策）を検証し、ブラウザでデコード確認。メタデータはHTMLとして描画しません（Reactのエスケープ）。
- 完全バックアップZIP: 圧縮エントリを受け付けない（展開しない）、パスの許可リスト、ヘッダ整合性、SHA-256/CRC検証。詳細は [backup.md](backup.md)。
- 取込・復元は全検証が通るまで既存データを変更しません。置換前に1世代の取込前バックアップをDBに保存します。
- 未知の安全なJSONフィールドは保持します。

## 保存の整合性

- 保存は1トランザクションで全ストアを更新し、revisionで複数パネルの競合を検出します（競合時は書き込まず保存エラー表示）。別パネル/タブの保存はローカルの `BroadcastChannel` で通知し、明示操作で読み込めます。
- 破損DBを自動初期化しません。移行（v1/v2→v3）は元データのバックアップ保存成功後に行う原子的なupgradeです。

## 依存関係・配布物・CI

- 実行時依存は React / React DOM（MIT、間接的に scheduler）のみ。lockfileを `--frozen-lockfile` でCI検証します。
- `pnpm audit`（2026-11-21）: 実行時・開発時とも既知の脆弱性 0件。以前（2026-11-18）報告されていた開発用ツールの `picomatch`（GHSA-fc5q-39xc-vjpf、配布物外）は現在報告されていません。
- インストール済みの全155パッケージのライセンスは MIT / BSD / ISC / Apache-2.0 / MPL-2.0（MPL-2.0はビルドツールのみで配布物に含まれない）。
- 配布物（`.output/chrome-mv3` と `pnpm zip` のZIP）には、拡張機能のコードと `LICENSE.txt`、同梱したサードパーティのライセンス表示 `THIRD_PARTY_NOTICES.txt`（React・React DOM・scheduler・Viteのpreload helper・WXTの実行時コード）だけを含めます。source map・テスト・fixtureは含みません（`extension.spec.ts` がファイル一覧を検証、`tests/unit/release.test.ts` がライセンス表示の欠落を検出）。
- バンドル内の `fetch` はViteのmodule preload helper（拡張機能自身のchunkの先読み）だけで、外部URLへの通信はありません。
- GitHub Actions: ワークフローのトークンは `contents: read` のみ、checkoutは認証情報を保存しない（`persist-credentials: false`）、Actionはコミットのフルハッシュで固定し、Dependabotで更新します。シークレットは使いません。
- 秘密情報の検査: Gitleaks 8.30.1 で全コミット・作業ツリーを検査し検出なし（2026-11-21）。

## 確認済み・未確認

- 自動テストはローカルfixtureと、`https://novelai.net/**` をPlaywrightで模擬HTMLに差し替えた実content scriptで行っています。**実NovelAIでの書込み・ログイン後UI・生成検知は未検証で無効**です。
- ツールバーボタンからサイドパネルが開くことは、Chromiumで `getPanelBehavior()` が `openPanelOnActionClick: true` であることまで自動確認しています（実ボタンのクリックは手動確認項目）。

## 参照

- NovelAI Terms https://novelai.net/terms
- Chrome side panel https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome extension storage https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
