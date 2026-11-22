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
- 暗号化した完全バックアップ: Web CryptoのPBKDF2-SHA-256（60万回）とAES-256-GCM（チャンクごとに認証、ヘッダを追加認証データに含める）。ヘッダは鍵の導出前に厳密に検証し、反復回数の上限でCPUを使い切る入力を拒否します。パスワードは保存しません（[backup.md](backup.md#平文と暗号化issue-33)）。暗号化しないZIP・JSONは平文であることを画面と文書に明記しています。
- 未知の安全なJSONフィールドは保持します。

## 保存の整合性

- 保存は1トランザクションで全ストアを更新し、revisionで複数パネルの競合を検出します（競合時は書き込まず保存エラー表示）。別パネル/タブの保存はローカルの `BroadcastChannel` で通知し、明示操作で読み込めます。
- 破損DBを自動初期化しません。移行（v1/v2→v3）は元データのバックアップ保存成功後に行う原子的なupgradeです。
- 保存前に画面を閉じたときの一時退避は、この拡張機能自身のオリジンのlocalStorageにだけ書きます（外部送信なし）。読み込み時は信頼できない入力として `validateData` で検証し、読み取れないものは削除します。開いている画面の判定にはWeb Locks（`navigator.locks`、名前はランダムな画面IDだけ）を使います（[DATA_MODEL.md](DATA_MODEL.md#現在のストア)）。

## 依存関係・配布物・CI

- 実行時依存は React / React DOM（MIT、間接的に scheduler）のみ。lockfileを `--frozen-lockfile` でCI検証します。
- `pnpm audit`（2026-11-22）: 実行時・開発時とも既知の脆弱性 0件。以前（2026-11-18）報告されていた開発用ツールの `picomatch`（GHSA-fc5q-39xc-vjpf、配布物外）は現在報告されていません。以降は `security.yml` が週1回とPR・pushで検査します（[セキュリティ検査（CI）](#セキュリティ検査ci)）。
- インストール済みの全155パッケージのライセンスは MIT / BSD / ISC / Apache-2.0 / MPL-2.0（MPL-2.0はビルドツールのみで配布物に含まれない）。
- 配布物（`.output/chrome-mv3` と `pnpm zip` のZIP）には、拡張機能のコードと `LICENSE.txt`、同梱したサードパーティのライセンス表示 `THIRD_PARTY_NOTICES.txt`（React・React DOM・scheduler・Viteのpreload helper・WXTの実行時コード）だけを含めます。source map・テスト・fixtureは含みません（`extension.spec.ts` がファイル一覧を検証、`tests/unit/release.test.ts` がライセンス表示の欠落を検出）。
- バンドル内の `fetch` はViteのmodule preload helper（拡張機能自身のchunkの先読み）だけで、外部URLへの通信はありません。
- リリース: `release.yml` はCIを再利用して迂回できず、ビルド・検証は読取り専用トークンで行い、公開ジョブだけが `contents: write`（プロジェクトのコードを実行しない）。ZIPには `.sha256` を添付する。
- GitHub Actions: 通常のワークフローのトークンは `contents: read` のみ（例外はリリースの公開ジョブの `contents: write` と、CodeQLの結果アップロードの `security-events: write`）、checkoutは認証情報を保存しない（`persist-credentials: false`）、Actionはコミットのフルハッシュで固定し、Dependabotで更新します。シークレットは使いません。
- 秘密情報の検査: Gitleaks 8.30.1 で全コミット・作業ツリーを手動で検査し検出なし（2026-11-21）。以降は `security.yml` が全履歴を自動で検査します。

## セキュリティ検査（CI）

`.github/workflows/security.yml` が、依存関係・秘密情報・静的解析の検査を行います。通常のCI（`ci.yml`）とは別のワークフローで、リリースの経路（`release.yml` が再利用するのは `ci.yml` だけ）には入れていません。検査の追加でリリースやCIが遅くなったり、無関係な理由で止まったりしないようにするためです。

| ジョブ | 内容 | 実行するとき | 失敗する条件 |
|---|---|---|---|
| Dependency audit | `pnpm install --frozen-lockfile --ignore-scripts` → `pnpm audit --prod --audit-level=moderate`（実行時依存）→ `pnpm audit --audit-level=moderate`（開発用を含む全体） | 週1回（月曜 03:17 UTC）・手動・`main` へのPR・`main` へのpush | 実行時依存にmoderate以上の勧告: 常に失敗。開発用依存の勧告: 週1回・手動の実行だけ失敗（PR・pushでは警告を出して成功） |
| Dependency review | `actions/dependency-review-action`。PRで追加・更新される依存（npm・GitHub Actions）を確認 | `main` へのPRだけ | moderate以上の脆弱性がある依存の追加・更新（実行時・開発用とも）、許可リスト外のライセンス |
| Secret scan (Gitleaks) | Gitleaks 8.30.1 で全ブランチ・タグの全コミットを検査（`fetch-depth: 0`、`--log-opts="--all"`）。値は伏せ字（`--redact=100`） | 週1回・手動・PR・push | 検出が1件以上、またはGitleaksの取得・照合の失敗 |
| CodeQL | `javascript-typescript`（ソース・テスト・スクリプト）と `actions`（ワークフロー）を `build-mode: none`・既定のクエリで解析し、結果を Security → Code scanning に送る | 週1回・手動・PR・push | 解析自体の失敗。見つかった警告は Code scanning と、PRの「CodeQL」チェック（失敗とする重要度はリポジトリ設定の Code scanning の保護ルールで決まる） |

### 方針

- **最小権限**: ワークフロー全体のトークンは `contents: read`。CodeQLのジョブだけが結果のアップロードに `security-events: write` を持ちます。シークレット・ライセンスキーは使いません（GitleaksはActionではなくリリースのバイナリを使うため不要）。checkoutは `persist-credentials: false`。
- **固定と再現性**: Actionはコミットのフルハッシュで固定（コメントにタグ）し、Dependabot（`github-actions`）が更新します。Gitleaksはバージョンと `linux_x64.tar.gz` のSHA-256をワークフローに直接書き、ダウンロードしたファイルをその値で検証し、さらにリリースの `checksums.txt` に同じ値があることを確認します（どちらかが違えば失敗）。依存はlockfileのとおりに入れ、合わなければ失敗します。
- **開発用依存の扱い**: 勧告は依存を変更していなくても公開されるため、配布物に含まれない開発用ツールの勧告ではPR・pushを止めません（ログに警告）。代わりに週1回の実行が失敗し続けて対応を促します。PRが新たに持ち込む脆弱な依存は、Dependency reviewが開発用でも止めます。実行時依存（配布物に入るReact・React DOM）は常に止めます。
- **ライセンス**: 許可リストは MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0。Dependency reviewは実行時・開発用を区別しないため、「MPL-2.0はビルドツールだけ」は、実行時依存をReact・React DOMに固定する `tests/unit/release.test.ts` とレビューで守ります。ライセンスを判定できない依存は報告だけで失敗しません（Actionの仕様）。
- **秘密値をログに出さない**: Gitleaksは `--redact=100` で値を `REDACTED` に置き換えて出力します。`--log-level` を `debug`/`trace` にしないでください（デバッグログには伏せ字にする前の値が含まれます）。レポートファイルやartifactは作りません。
- **検査の設定の変更はレビューで確認**: PRのワークフローはPR側の `security.yml`・`.gitleaks.toml`・`.gitleaksignore` で動くため、これらの変更と `gitleaks:allow` コメントの追加は必ずレビューで確認します。現在、`.gitleaks.toml`・`.gitleaksignore` はありません（Gitleaksの既定のルールをそのまま使用）。

### ローカルでの再現

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm audit --prod --audit-level=moderate   # 実行時依存（常に0件であること）
corepack pnpm audit --audit-level=moderate          # 開発用を含む全体
gitleaks git --redact=100 --verbose --log-opts="--all" .   # Gitleaks 8.30.1（CIと同じ版）
```

Dependency reviewとCodeQLはGitHub上でだけ実行します。手動で全体を実行するには Actions の「Security」→「Run workflow」を使います。

### 失敗したとき

**依存関係の勧告**（Dependency audit・Dependency review・Dependabot alerts）

1. 対象と経路を確認する: `corepack pnpm audit`、`corepack pnpm why <パッケージ>`。実行時（配布物）か開発用か、この拡張の使い方で影響するかを調べる。
2. 更新する（優先）: 直接依存を修正版に上げる。Dependabot security updatesのPRがあれば、その内容を確認して使う。lockfileを更新し、`test`・`typecheck`・`build`・`test:e2e` を通す。実行時依存なら `public/THIRD_PARTY_NOTICES.txt` も更新する。
3. 上流が未修正の間接依存は、`package.json` の `pnpm.overrides` で修正版に固定する（互換性をテストで確認し、上流が直ったら外す）。
4. 受け入れる（最後の手段。影響しない、または修正版がない場合だけ）: GHSA IDを `package.json` の `pnpm.auditConfig.ignoreGhsas`（`pnpm audit`）と、必要なら `security.yml` の `allow-ghsas`（Dependency review）に追加し、下の「既知の例外」に理由・日付・見直し時期を書く。実行時依存の受け入れはメンテナーが判断する。
5. レジストリやAPIの一時的なエラーで失敗したときは再実行する（エラーを無視する設定にはしない）。

**Gitleaksの検出**

1. 本物の秘密情報として扱う。値をIssue・PR・コメント・チャットに貼らない（CIのログは伏せ字。伏せ字なしの確認は手元だけで行う）。公開リポジトリの履歴に入った値は、消しても既に漏えいした（clone・fork・キャッシュに残る）ものとみなす。
2. **最初に発行元で失効・再発行（ローテーション）する。**
3. 作業ツリーからは通常のコミットで取り除く。**履歴の書換え（`git filter-repo`・force push など）はメンテナーの判断なしに行わない**（`main` はルールセットでforce pushを禁止。全てのclone・PRに影響し、失効の代わりにもならない）。未マージのPRのブランチだけにある場合も、先に失効させる。
4. 失効後も履歴に残る検出は、Gitleaksの出力の `Fingerprint`（`<commit>:<file>:<rule>:<line>`）を `.gitleaksignore` に1行で追加し、直前の `#` コメントに「失効済み・日付・理由」を書く。下の「既知の例外」にも記録する。
5. 誤検知（合成fixture・ハッシュ・例示の値など）は、まずテストデータを明らかに偽物と分かる値や実行時の生成に変える。変えられない場合だけ、Fingerprintを `.gitleaksignore` に追加する（理由をコメント）か、パス・正規表現を絞った `.gitleaks.toml`（`[extend] useDefault = true` の上に `[[allowlists]]`）を追加して各項目に理由を書く。ルール全体の無効化や広いパスの除外はしない。
6. GitHubのSecret scanning・Push protection（有効）の警告も同じ手順で扱う。

**CodeQLの警告**

1. Security → Code scanning（PRではチェックの注釈）で、内容とデータの流れを確認する。
2. 実際の問題なら修正し、可能なら再現するテストを追加する。
3. 誤検知・テスト専用のコードなど対応が不要な場合は、警告の画面で理由（False positive / Used in tests / Won't fix）とコメントを付けて却下（Dismiss）する。クエリやパスの除外設定で隠さない（除外が必要なら `docs/DECISIONS.md` に記録する）。
4. 解析自体が失敗したときはログを確認して再実行する。リポジトリ設定でCodeQLの「Default setup」を有効にすると、このワークフローの結果が受け付けられなくなるため、有効にしない（どちらか一方だけを使う）。

### Gitleaksの更新（Dependabotの対象外）

1. `gh api repos/gitleaks/gitleaks/releases/latest` で最新の安定版を確認し、変更点を読む。
2. リリースの `gitleaks_<版>_checksums.txt` にある `gitleaks_<版>_linux_x64.tar.gz` の値と、同じAPIの `assets[].digest` が一致することを確認する。
3. `security.yml` の `GITLEAKS_VERSION` と `GITLEAKS_SHA256` を一緒に更新し、この文書の版の表記も直す。

### 既知の例外

例外（受け入れた勧告、Gitleaksの許可、却下したCodeQLの警告のうち設定で扱うもの）は、ここに理由とともに記録します。

| 種類 | 対象 | 理由 | 記録日 | 見直し |
|---|---|---|---|---|
| — | なし | — | 2026-11-22 | — |

## 確認済み・未確認

- 自動テストはローカルfixtureと、`https://novelai.net/**` をPlaywrightで模擬HTMLに差し替えた実content scriptで行っています。**実NovelAIでの書込み・ログイン後UI・生成検知は未検証で無効**です。
- ツールバーボタンからサイドパネルが開くことは、Chromiumで `getPanelBehavior()` が `openPanelOnActionClick: true` であることまで自動確認しています（実ボタンのクリックは手動確認項目）。

## 参照

- NovelAI Terms https://novelai.net/terms
- Chrome side panel https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome extension storage https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
