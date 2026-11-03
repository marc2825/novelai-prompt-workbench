# 実装ステータス

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
