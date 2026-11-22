# 技術設計

## レイヤ

```text
Toolbar button ──(background.js: sidePanel.setPanelBehavior のみ)──▶ Side Panel
Chrome Side Panel / 広いタブ (React, 同じ sidepanel.html)
  ├── Library / Workspace / Preset / Shuffle / Compare / Experiment Lab / Settings
  ├── Application commands + undo / redo (useWorkbench)
  ├── IndexedDB repository + migrations + JSON / 完全バックアップZIP
  ├── BroadcastChannel（別パネル/タブの保存通知、ローカルのみ）
  ├── Pure compiler & validator (src/core)
  └── chrome.tabs messaging
          ↓
NovelAI content script (isolated world, minimal message schema)
          ↓
NovelAIAdapter (capability detection + safe DOM read/write)
          ↓
NovelAI image UI (unknown selectors until inspected)
```

## 技術選択

- WXTにManifest生成を任せる。`manifest.json`を二重管理しない。`srcDir`を使わず、`entrypoints/`をリポジトリ直下に置く。
- Reactはサイドパネルだけに置く。DOM bridgeはUIに混ぜない。
- `src/core` は全て純粋関数。OS依存、Chrome API、ネットワーク、DOM API無し。
- IndexedDBはライブラリ/ワークスペース/サムネイル/実験を保持。設定のみ`chrome.storage.local`でも良い。sidepanel→contentで直接DB共有前提を置かず、必要なテキストだけメッセージ化する。
- バックグラウンドservice workerは「ツールバーボタンでサイドパネルを開く」ためだけに置く（`entrypoints/background.ts`、状態・通信・タブ参照なし）。永続プロセスとみなさない（2026-11-18、ADR-074）。

## 境界・アダプタ契約

```ts
interface NovelAIAdapter {
  capabilities(): Promise<{ canReadPositive: boolean; canWritePositive: boolean; canReadNegative: boolean; canWriteNegative: boolean; reason?: string }>;
  readPrompts(): Promise<{ positive?: string; negative?: string }>;
  applyPrompts(next: { positive?: string; negative?: string }, expected?: { positive?: string; negative?: string }): Promise<{ ok: boolean; error?: string }>;
}
```

- DOMのセレクタは`src/platform/novelai/`内でのみ設定。コードレビュー中にブラウザでDOMを検証するまで書込実装禁止。
- `applyPrompts`: ユーザーのクリック時のみ。元の値を読み取ってプレビューする。上書きはUIで明示確認。`expected`と現在値が不一致なら競合警告し中止。成功/失敗を返す。入力イベントは現行UIで実機検証。
- マッチしない要素・複数の曖昧候補・SPA再描画で失われた要素には書かない。
- 公式Prompt Chunksの内部APIや認証情報にはアクセスしない。
- NovelAIがプロンプト入力以外の生成設定を容易にDOM操作可能にしてもP3では**自動で変更しない**。Seed等はユーザー確認＋PNGメタデータで証跡。

## データ永続化

- DBスキーマは`docs/DATA_MODEL.md`。一意のUUIDと`schemaVersion`が必要。
- 1操作を1トランザクションにまとめる。書込失敗時にUIへエラー。アプリ起動時にmigration/version check。
- ローカルJSONバックアップは画像バイナリを含まない。完全な画像付きバックアップは将来ZIP形式で設計。
- 大容量Blob保存の上限・削除回復・ユーザーの容量警告を考慮。
- Snapshot時は原文もコピーしてプリセットと実験の再現性を担保。

## セキュリティ / プライバシー

- Manifest: `https://novelai.net/*` 等、実機確認した最小ドメインだけ。`<all_urls>`は禁止。
- `activeTab`等の権限は必要性が確定してから追加。
- ユーザーの画像・プロンプト・設定を外部の自社サーバーに送信しない。
- `content script`はISOLATED worldを原則とし、ページの内部JSに触れる「main world」注入は不採用。
- 任意HTMLレンダリング、`innerHTML`のユーザー入力使用、eval、リモートスクリプト禁止。
- メッセージを型検証し、読み書き先は対象画像ページだけ。必要なタブIDを明示。

## 想定リスクと対応

| リスク | 対応 |
|---|---|
| NovelAI UI/セレクタ変更 | Adapter隔離、detect失敗、copy fallback |
| React管理フォームが外部値を巻き戻す | 現行DOMで確認。成功を読み戻し検証 |
| コメントアウトで原文破壊 | editor stateのdisabled span、復元テスト |
| マクロ/重み構文の誤パース | rawフラグメントの原文保持。カンマ分割禁止 |
| 大量画像によるDB肥大 | thumbnail最適化、容量表示、削除機能 |
| A/Bの条件不一致 | 設定diffと「未確認」警告 |
| 予期しない自動課金/生成 | 自動Generateクリックを実装しない |

## P2実装

- `src/platform/novelai/`にadapter契約、観測済みのlive読取り専用adapter、検証profile用textarea adapter、protocol validator、Content Script handler、タブtransport/clientを分離。UIはDOMへアクセスせずclientを使用する。
- `entrypoints/novelai.content.ts`は画像ページのISOLATED worldでメッセージを待つ。ロードだけで入力の読取り・書込み・生成を行わない。拡張IDと`sidepanel.html`のsender URLを検証し、ページ由来や別contentからの要求を拒否する。
- tabs権限とhost_permissionsは追加しない。明示的な接続確認で現在windowのtab IDだけを列挙し、既存の静的content scriptへframe 0指定でinspect。inspect応答に原文を含めず、対象タブは自動選択しない。
- 操作は `inspect → read / prepare → UI上の変更前後表示・明示確認 → apply`。タブID、document UUID、完全URLを固定。prepareでDOM要素token・原文・挿入位置を保持し、60秒の一回限りticketを発行する。
- applyは既存値と同じ要素・同じ選択範囲（挿入時）を比較してから実行。反映とhandler側の再読取りの両方で一致を検証し、clientもchannel/target/結果を照合。重複操作・再送・再読込・SPA移動は拒否。通信は5秒で失敗表示し、自動再試行しない。
- 一度に1チャンネルだけ反映し、両チャンネル同時操作の部分成功を避ける。復旧用の反映前原文はパネル内に1件保持。Undoは拡張の編集状態だけを戻す。
- 製品のlive adapterは観測済みの単純ProseMirror DOMからの**読取り専用**。実NovelAI書込みprofileはまだ存在しない。`TextareaAdapter`の成功は実サイト書込みを証明しない。
- textarea fixtureではnative setterとinput/changeイベントを使用し、80ms後に値・要素を再検証。例外時は同じ要素に自分が書いた値がそのまま残る場合だけ元へ戻す。他の編集や差し替わった要素は上書きしない。
- `tests/fixtures/site.html`はReact controlled textareaと仮想タブ2個を持つ。別の拡張E2Eでは実ブラウザタブ2個・実Content Scriptを使用し、模擬NovelAI HTMLをPlaywrightでローカル応答する。テストが実サービスへアクセスしない構成にしている。

## P3プリセット実装

- `src/core/presets.ts`にcapture/save/rename/duplicate/overwrite/apply/delete、dirty比較、設定差分と辞書参照診断を置く。出力は常に既存`compileWorkspace`を呼び、プリセット専用コンパイラを作らない。
- snapshotは独立した原文のコピー。snapshot→presetのリンクは禁止し、再帰的なプリセット展開は実装しない。作成元IDは診断用のprovenance。
- 適用に必要なUUID候補と時刻はUIで準備してcoreへ値として渡す。core内で乱数・時計・DOMを使わず、同じ入力から同じ適用結果を得る。
- applyはworkspace全体と適用元bindingを1つのimmutable commandで置換する。既存のhistoryに1回だけrecordし、Undo/Redoで未保存編集やactive workspaceまで戻る。libraryとpreset recordは変更しない。
- `src/ui/Presets.tsx`をWorkspace/プリセットタブで共用。ドロップダウン選択はpreviewだけ。現在/適用後の両channelと設定差分、未保存状態、参照診断、確認を経て適用する。保存済みsnapshotの更新は別の明示上書き操作。
- `PresetStatus`で全タブから「プリセットと一致／プリセットに未保存」を確認できる。workspace自体のDB自動保存とpreset保存を区別する。
- IndexedDB v2はpresets storeを追加。バックアップの永続書込み成功後にschemaを変更し、upgrade transaction全体を原子的にcommit/rollbackする。blocked upgradeは勝手に後から進めず、再openを必要とする。
- 不正なv1の移行は中止し、`MigrationError.snapshot`をUIへ渡して復旧dumpを可能にする。未知DB版や欠損storeは自動初期化しない。
- JSON v1を検証・正規化し、v2でpreset/binding/snapshotを保存。mergeは既存のID衝突拒否を維持。snapshot内のIDは独立scopeで扱い、live workspaceへ移すときだけ衝突を解決する。
- P2のlive read-only adapter・メッセージ・サイトwrite能力は変更しない。preset適用はローカル状態変更のみで、サイトへ自動送信しない。権限・依存・entrypointの追加なし。

## P4画像・比較実装

- `core/experiments.ts`: immutable snapshot作成/複製、raw文字差分、group設定差分、未知値を含む生成設定比較、RGBA差分。snapshot合成は共通composeのみ。DOM/乱数/時計APIを持たない。
- `core/png.ts`: PNG署名/CRC/チャンク/寸法/サイズ上限の純粋検証。`data/images.ts`がbounded DecompressionStream、標準text、交換可能metadata parser、crypto SHA-256、ブラウザdecodeとthumbnailを担当する。公式NovelAIサンプル未取得のため固有形式はunknown fallback。NovelAI公式形式の入れ物（PNGテキスト・アルファチャンネル）は`core/png-stealth.ts`（行フィルタ解除とアルファ最下位ビット、純粋）と`data/novelai-metadata.ts`（展開・検証・候補）で読み、`ui/NovelAIInfo.tsx`で未確認の候補として表示する（ADR-099）。
- `data/repository.ts`: v3にexperiments/images/imageOriginals/imageThumbnailsを追加。v1/v2 backup upgrade、revisionによる競合検出と原子保存。JSONにBlobは入れない。
- `ui/useWorkbench.ts`: 画像writeを保存キューへstageし、metadata/slotと共にcommit。失敗時は未保存状態とBlobを維持しretry可能。Undoはmetadataのみを保持、明示purge時は履歴/backupを保護する。
- `ui/Comparisons.tsx`: source選択→A/B固定→B案編集/preview/確定→手動copy→各PNG取込。セッションCRUD/設定diff/metadata照合と手入力/容量/欠落通知。workspaceやサイトを暗黙に更新しない。
- `ui/ImageComparison.tsx`: BlobからのObject URLをeffect cleanupで解放。遅い非同期読込はcancelし、bitmapもclose。同期zoom/pan、横並び/ワイプ/サイズ条件付きpixel diff。Canvasは検証済みローカルPNGのみ。

## Prompt Shuffle

- 純粋エンジン `src/core/shuffle`、検証/移行 `src/data/shuffle.ts`、複数欄プロトコルと生成オブザーバ `src/platform/novelai`、UI `src/ui/Shuffle.tsx` と `src/ui/shuffle/`。詳細・依存関係・判断は `docs/shuffle/architecture.md`。
- 実NovelAIの live adapter は引き続き読取り専用。キャラクター欄・生成検知・位置は能力falseを返し、パネルはコピーと手動記録に切り替える。

## Experiment Lab

- `core/lab/types.ts`は定義/軸/条件/手動進捗、`values.ts`は数値範囲・CSV・Seed、`prompt.ts`は最上位項目の範囲編集、`engine.ts`は直積・モデル制約・固定条件・テンプレート。時計/乱数/DOMは渡さない。
- `data/lab.ts`は保存検証・複製。既存validationで再展開snapshotを照合し、metadata.extraへ保存。`lab-export.ts`はJSON/CSV/ZIP、`lab-grid.ts`はローカルCanvas出力。
- `ui/lab/Setup.tsx` / `Lab.tsx` / `Results.tsx`は設定、手動進捗と取込、グリッド。実験の変更案は明示確定し、作成後の定義は固定。既存ImageComparison/useWorkbenchの保存キューを共用する。
- SiteConnectionに成功した反映の通知callbackを追加。Labはその記録から対象タブ/document/channelの元原文を保持し、最後の反映値を確認してから既存SiteClientで復元preview/applyする。新しいsite selector・権限・content scriptは追加しない。

## 2026-11-18の変更

- 完全バックアップ: `src/data/zip.ts`（無圧縮ZIPの書込み・厳格な読取り）、`src/data/full-backup.ts`（書出し・検証・復元計画）、`src/ui/FullBackup.tsx`、`useWorkbench.restoreFull`（1トランザクションの直接保存、実行中は編集不可）。形式は [backup.md](backup.md)。
- シャッフルのサイト状態: `src/core/shuffle/site-session.ts`（対象別セッション）、`src/ui/shuffle/auto-run.ts`（自動シャッフルの実行単位）。詳細は [shuffle/site-adapter.md](shuffle/site-adapter.md)。
- 保存: 通常の保存はrevisionだけを読み、検証済みオブジェクトを再検証しない（ADR-077）。別パネル/タブの保存は `BroadcastChannel` で通知（ADR-076）。
- 送信元URL照合の修正（`isPanelSender`、ADR-075）。

## タグ辞書・入力補完（2026-11-22）

- `core/tags.ts`: 照合用の正規化、キャレット位置の判定（`completionTokenAt`）、範囲置換（`applyCompletion`）、ライブラリ原文からのタグ抽出、ソート済み索引と二分探索の候補検索、表記ゆれ・重複の一覧。純粋関数で外部データ・通信なし。
- `ui/TagCompletion.tsx`: Appが索引のsourceをContextで渡し、`PromptEditor`が使う。索引は最初の検索時に作り、ライブラリ原文・辞書が実際に変わったときだけ作り直す。確定は`insertText`（ブラウザのUndoと通常のinputイベント）で行い、使えない場合は通常の`onChange`。
- `ui/TagDictionary.tsx`: ライブラリタブの辞書管理と読取り専用の表記ゆれ一覧。検証は`data/validation.ts`。
