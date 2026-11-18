# 実装ステータス

## Experiment Lab（2026-11-16）

| Phase | 状態 | 実装・制約 |
|---|---|---|
| 1 条件生成 | 実装・自動検証済み | XYZ、タグ操作、数値/CSV/行候補、Seed群・反復、7テンプレート、全件preview、最大512条件 |
| 2 手動連携 | 手動補助を実装・fixture検証済み | 既存SiteClientで読取り・確認付き反映・CAS/readback。条件ID付きPNG登録。条件切替後の原文復元もCAS。実NovelAIは読取り専用、設定同期は手動 |
| 3 比較・保存 | 実装・自動検証済み | XYZグリッド、Seed/反復ページ、A/Bワイプ・差分、評価・メモ、履歴/複製/再開、JSON/CSV/ZIP/グリッドPNG |
| 4 自動化・高度分析 | 未実装・Controlled Batch無効 | 正式な許諾・連携契約・実機profileが未確認。高度な統計分析は後続 |

検証（Node 24.21.0 / pnpm 10.34.5 / Playwright 1.64.1 Chromium）:

| コマンド | 結果 |
|---|---|
| `corepack pnpm install --frozen-lockfile --store-dir /tmp/nai-pnpm-store` | PASS、依存・lockfile変更なし |
| `corepack pnpm test` | **333 PASS / 0 FAIL、18ファイル**（既存283 + Lab50） |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm build` | PASS、sidePanelのみ、entrypoint追加なし |
| `corepack pnpm test:e2e` | **53 PASS / 0 FAIL**（既存49 + Lab4、Mock E2E） |

5/25/75条件、CSV/range、正負の重み・完全ラッパー・出現番号、Matrix因子、Seed桁保持、Medium制約、不正snapshot/壊れたDBの保持、quota rollback、PNGのID紐付け・欠落修復、評価、出力、再起動、手動反映と競合/原文復元を検証。ZIPはPython標準zipfileでもCRC・JSON・CSV・原本PNG2枚を検証済み。400pxの画面もスクリーンショットで確認。

再開後の環境でテスト用共有ライブラリが消えていたため、一度Lab E2E 4件がChromium起動前に失敗。libnspr4/libnss3/libasound2t64をapt-get downloadで `/tmp/nai-lab-libs` に取得・展開し、LD_LIBRARY_PATHを指定して全53件が成功。OSへのインストールはしていない。

実サイトの有料生成・ログイン後DOMの手動検証は未実施。設定の自動取得/反映/復元、キャラクター別欄、PNG自動捕捉、公式固有metadata解析、ZIP取込、完全な全アプリ翻訳は未対応。[操作・制約](../docs/lab/README.md)、[公式資料の調査](../docs/lab/RESEARCH.md)。

---

## タグ重みスライダー・画像比較UI（2026-11-16）

- Workspace/B変更案の自由入力・候補原文で、選択したタグだけを0〜2のスライダー（0.05刻み）または数値入力で調整。数値重み全体の再選択、標準1への復帰、変更後preview、1回Undo/Redo。複雑構文・コメント構造・不正選択・古い原文は保護する。
- Bの未反映プレビュー中は確定を無効化。A/元workspace/辞書は独立し、B確定時に旧画像の関連付けを解除する。PNG比較ビューを上部に移し、手動生成から比較までの手順を表示。
- 狭いサイドパネルでグリッドの最小幅が広がる問題を修正。400px幅で重みコントロールが収まることをMock E2E・スクリーンショットで確認。
- 永続化は従来のraw/snapshotのみ。DB/JSON v3、追加依存・権限・entrypointなし。README、PROMPT_SEMANTICS、AB_COMPARISON、DECISIONSを更新。

検証（Node 24.21.0 / pnpm 10.34.5 / Playwright Chromium、ローカルfixtureのみ）:

| コマンド | 結果 |
|---|---|
| `corepack pnpm install --frozen-lockfile --store-dir /tmp/nai-pnpm-store` | PASS（既存の書込み可能ストアを使用、lockfile変更なし） |
| `corepack pnpm test` | **283件 PASS / 0件 FAIL、17ファイル**（既存246 + 重み37） |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm build` | PASS（権限は `sidePanel` のみ） |
| `corepack pnpm test:e2e` | **49件 PASS / 0件 FAIL**（既存46 + 重み3、Mock E2E） |

E2Eは既存の `/tmp/portfolio-ci-libs/root/usr/lib/x86_64-linux-gnu` を `LD_LIBRARY_PATH` に指定し、localhost待受・Chromium起動が可能な実行環境で検証。途中のテスト修正: ラベルの検索方法1件、400pxでの幅超過2件を検出して修正し、新規3件の再実行は全PASS。

実サイトの手動検証は未実施。数値重みのモデル別解釈・生成効果、実NovelAIへの書込み、実NovelAI固有PNGメタデータは未検証。画像の自動生成は行わず、比較には手動保存PNGを使う。pushなし。

---

## Prompt Shuffle（2026-11-14）

| Phase | 状態 | 内容 |
|---|---|---|
| 0 Audit / ハーネス | 完了 | 調査結果と方針を `docs/shuffle/architecture.md` に記録。AGENTS.md統合、CLAUDE.md、Skill `novelai-prompt-shuffle` |
| 1 Core Engine | 実装・単体PASS | 型、Seeded PRNG、Pure/Bag/Weighted、直前・直近N件回避、役割割当、制約、カテゴリ置換の合成、モデル制限、`|`構文、生成カウンタ |
| 2 UI / 手動Apply | 実装・Mock E2E PASS | シャッフルタブ、キャラクター/テンプレート/プール/カメラ管理、現在・次回プレビュー、Shuffle Now、Apply/Restore、履歴、設定export/import |
| 3 NovelAI連携 | **fixtureのみ検証／実サイト非対応** | 複数欄プロトコル、能力検出、欄数照合、CAS・rollback・readback。実adapterは読取り専用のまま、キャラクター欄・モデル・生成検知・位置は能力false |
| 4 生成連動 | **fixtureのみ検証／実サイトは手動記録** | lease付きオブザーバ、job IDでの重複排除、再読込・再描画・失敗の除外、生成中は待機、編集検出で停止、手動+1の代替 |
| 5 品質 | 完了 | 下記の全コマンドPASS、ドキュメント更新 |

検証（Node 24.21.0 / pnpm 10.34.5 / Playwright 1.64.1 Chromium）:

| コマンド | 結果 |
|---|---|
| `corepack pnpm test` | **246件 PASS / 16ファイル**（既存184 + シャッフル62） |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm build` | PASS（権限は `sidePanel` のみ、entrypoint追加なし） |
| `corepack pnpm test:e2e` | **46件 PASS**（既存37 + シャッフル9） |

E2E環境: Playwright 1.64.1用Chromiumを `playwright install` で取得し、root権限なしで不足共有ライブラリ（libnspr4/libnss3/libasound2）を `apt-get download` + `dpkg -x` で作業用ディレクトリに展開して `LD_LIBRARY_PATH` に指定した。依存・lockfileの変更なし。

未検証・未実装: 実NovelAIでの書込み・キャラクター欄・生成検知・モデル検出・Character Positions（すべて無効/非対応として表示）。プリセットごとのプロファイル、バリエーション数推定、類似度ベースの構図回避。詳細は `docs/shuffle/limitations.md`。commit/push は行っていない。

---

更新: 2026-11-03（Asia/Tokyo）。ユーザー指定の**P4画像管理・手動A/B比較を実装**。既存資料のP3-Bに相当する。P0〜P3の機能・データを維持し、実NovelAIのwriteは無効のまま。

| Phase | 状態 | 内容 |
|---|---|---|
| P0/P1 | 実装・回帰PASS | MV3/WXT、辞書/カテゴリ/構成CRUD、検索、共通合成、Undo、JSON、復旧 |
| P2 | fixture検証済み／live write未検証・無効 | 範囲コメント、読取り、CAS/readback基盤。製品adapterは読取り専用 |
| P3プリセット | 実装・回帰PASS | 全CRUD、差分、dirty、1回Undo、参照診断、DB/JSON v2互換 |
| P4画像・A/B | 実装・自動検証完了 | 固定snapshot、B編集、生成条件、PNG取込、比較、DB/JSON v3 |
| NovelAI固有PNG解析 | **未実装・未検証** | 公式保存実サンプルが無いためcodex/05に従いunknown fallback |

## 実装済み

- 比較元は現在workspaceまたはpreset。A/Bに両channel、全group/候補/選択/コメント、preset由来、固定compiledをdeep snapshot。作成してもworkspaceを変えず、辞書/preset/sourceの変更・削除から独立する。
- 比較セッションの作成、自動保存、復元、改名、複製、削除。Bのみの自由入力/候補原文/範囲コメント/group選択を編集する未保存draft、preview、local Undo/Redo、明示確定。確定を全体履歴の1操作として戻せる。
- 別sourceからBを明示再固定できる。再固定は旧画像リンクを外し、生成条件は保持する。draft中はセッション切替を止め、画面切替/再読込時に破棄を確認する。
- 原文の文字差分とgroup設定差分、両channelの個別コピー。特殊構文をタグに分割・再解釈しない。サイト入力へ自動反映しない。
- model/Seed（桁落ちしない数字文字列）/寸法/Steps/Sampler/Guidance/CFG Rescale/枚数/img2img/参照条件/extra/evidenceを保持。nullや未確認extraは「検証不能」、既知の不一致は「設定不一致」、厳密比較不可を明示する。
- PNGの手動選択/1枚ドロップ、署名/CRC/チャンク/寸法/デコードの検査。SHA-256で同一バイト列を再利用し、最大256pxサムネイルを生成。画像一覧、slot関連付け、原本download、削除/Undo、欠落診断。
- PNG標準tEXt/zTXt/iTXtテキストを上限付きで抽出。文字列として保持してReactでエスケープ。生成metadata parser interfaceを分離し、**明示的なworkbench形式だけ**構造化Prompt/Seed/settingsをsynthetic PNGで検証。NovelAI固有キーは推測せず不明。
- 画像側のPrompt/生成条件を手入力で補完し、取得元を区別。固定Promptとの一致/不一致/不明を表示。画像設定をvariantへ採用するには確認が必要で、Promptは自動変更しない。
- 横並び、ワイプ、共通物理倍率のzoom/pan、矢印キーpan。寸法違いを警告。pixel diffは同寸法か、明示的なB→A変形を選んだときのみ計算し、補間/縦横比変更の条件を表示。
- 画像metadata/原本/thumbnailを別storeへ保存。Blobのhash/寸法/型/バイト数を再検証し、読取り時もmetadataとのbindingを照合し、metadata/slot/revision/backupと同一transactionで保存。quota失敗時は原DBを保持し、未保存状態・再試行を提供。
- Object URLはeffect cleanupやdownload完了後にrevoke、ImageBitmapをclose、非同期処理の古い結果を破棄。保存失敗時の原本も画面からdownload可能。
- 容量の概算表示、明示purge。削除はBlobを即消去せず、現在資産・Undo/Redo・取込前backupの画像を保護して、参照されないものだけ解放する。
- DB v1/v2→v3は元record/metadataのbackup保存成功後にstoreを追加する原子upgrade。失敗はversion/store/data全体rollback。旧previousImportを保持し、設定から旧資産をJSON退避可能。
- JSON v1/v2を読み、v3で比較/画像metadataを出力。`imageBinariesIncluded:false`。元PNGを別途保存する必要をUIに明記し、別プロファイル復元後の欠落と同一PNG再取込による修復を提供。

## 上限・互換性

- PNGのみ。20MiB、各辺8192px、合計16,777,216px。APNG/JPEG/WebPは未対応。
- textは入力と展開後とも合計256KiB、128チャンク、PNG全体4096チャンク。prototypeキー/構造不正/圧縮爆弾を拒否。検証不能な構造化生成metadataは原文textを残してunknownにする。
- ピクセル差分は各画像4,194,304pxまで。ブラウザがデコードしたsRGB RGBAの絶対差。異寸法の明示変形はCanvas高品質補間、BをAの幅・高さに合わせる。元画像は不変。
- JSONは10MiB、深さ32、全snapshot/spanを含む10000レコード。Blob/履歴/site ticketを含めない。画像入りZIPは未実装。安全な未知JSONフィールドは保持。
- 旧v1/v2は画像/比較が未実装だったため、それらの非空配列を旧形式に混ぜた入力は拒否する。v3の固定compiledとsnapshot不一致、存在しない画像、循環、ID/ハッシュ重複なども拒否。
- Undo/Redoは最大30操作のメモリ履歴で、Chrome再起動後やサイト操作を戻さない。設定/画像注記フォームは各保存ボタンまで未確定。
- 旧ビルドへのDBダウングレード、破損旧DBの自動修復、複数パネルの自動mergeは対象外。更新競合時は従来通り停止する。

## 検証結果

環境: Node 24.21.0、pnpm 10.34.5、Linux、Chromium 156.0.8078.4。追加依存・lockfile変更・サイト権限追加・entrypoint追加なし。

| コマンド | 結果 |
|---|---|
| `corepack pnpm install --frozen-lockfile --offline --store-dir /tmp/nai-pnpm-store` | PASS |
| `corepack pnpm test` | **184件 PASS / 12ファイル**（既存129 + P4追加55） |
| `corepack pnpm typecheck` | PASS（strict） |
| `corepack pnpm build` | PASS。`.output/chrome-mv3/` |
| Chromium E2E | **37件 PASS**（既存27 + P4追加10）、38.8秒 |

```bash
LD_LIBRARY_PATH=/tmp/nai-chromium-deps/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/nai-pw-browsers corepack pnpm test:e2e
```

新規単体: experiments/images/image-storage。immutable snapshot、preset/source変更後の再現、特殊文字diff、不明/不一致、Seed精度、不正JSON、循環、固定文字列不整合、pixel計算、PNG破損/巨大/圧縮/悪意metadata、v1/v2 JSON、v2移行/rollback、Blob分離/再開/欠落/不整合、実験IDとのpreset再採番、未知設定の未確認判定、quota原子性、purge保護を検証。

新規E2E: comparisons.spec.ts。session CRUD/B変更/Undo、preset削除後再現、metadata有無、file/drop、同一hash、異寸法/resize/ワイプ/同期pan、画像保存/再読込、同一IDのmetadata/Blob不整合の拒否と修復、破損decode、JSONの別profile復元/欠落修復、quota/retry、実v2 upgrade、手入力/原本export/URL解放。既存unpackedテストも画像と比較を保存し、**Chrome完全終了→再起動**で復元するよう拡充。

AC15: 不明/不一致を厳密比較不可と表示。AC16: metadataなしPNGを表示し生成値はnull。AC17: 生成/認証/APIの操作なし。P0〜P3の既存129単体と27 E2Eを回帰対象に維持し、現在schemaの期待だけv3へ更新している。

## 未検証・制限

- **実NovelAIへの書込みは未検証・無効のまま。** 今回は実サイトにアクセスしていない。fixture/unpackedでの成功を実サイトwrite対応とは扱わない。
- **NovelAIの公式保存PNGは実サンプル未取得。** 固有metadataのPrompt/Seed/モデル設定を抽出できるとは主張しない。標準textとunknown fallback・手入力を提供。stealth metadata等の未知形式も未対応。
- 実ディスク満杯・実quota上限の到達は未検証（quota例外をfake-IDB/Chromiumへ注入してrollbackとretryを検証）。上限近辺の大画像/大量履歴の長期メモリ・性能、全画像色空間/ICC/16bitの厳密なpixel再現は未検証。
- 手動Side Panelドッキング、ログイン後UI/rich node/Character Prompts/言語切替、GitHub Actions実行、Node 22での実測は未検証。
- commit/push/deploy、外部サービス呼出し、自動生成、画像の外部送信は行っていない。
