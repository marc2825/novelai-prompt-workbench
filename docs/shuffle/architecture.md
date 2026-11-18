# Prompt Shuffle — アーキテクチャ

更新: 2026-11-14。実装と一致させること。関連: [data-model.md](data-model.md) / [site-adapter.md](site-adapter.md) / [test-plan.md](test-plan.md) / [limitations.md](limitations.md)。

## 1. 事前調査（Phase 0）の結果

| 項目 | 調査結果 | Shuffleでの扱い |
|---|---|---|
| 構成 | WXT 0.21.5 + React 19 + TS strict。`entrypoints/`（sidepanel / novelai content script の2つだけ）、`src/core`（純粋）、`src/data`（IDB・検証）、`src/platform/novelai`（DOM）、`src/ui` | 提案の `src/features/shuffle/` ではなく既存レイヤに合わせて配置（下表）。entrypoint・権限・依存は追加なし |
| Manifest | 権限は `sidePanel` のみ。host_permissions・background なし。content script は `https://novelai.net/image*` の ISOLATED world | 変更なし（E2Eで検査） |
| NovelAI連携 | `inspect → prepare（60秒・一回限りticket）→ 確認 → apply → readback`。製品の `LiveReadOnlyAdapter` は公開ページで観測した ProseMirror の**読取り専用**。書込みは検証済みprofileの `TextareaAdapter`（ローカルfixture専用）のみ | **読取り専用を維持**。複数欄の書込み経路を同じticket/CAS方式で追加し、実サイトでは能力falseで安全に停止 |
| 辞書・トグル・プリセット | `WorkbenchData` を1トランザクションで保存。`compileWorkspace` が唯一の合成器。プリセットはsnapshot | ベースプロンプト＝アクティブworkspaceの `compileWorkspace` 出力。既存データ構造は変更せず `shuffle?` を追加 |
| 状態管理・永続化 | `useWorkbench` の commit（validateData → 30件Undo履歴 → revision付き保存キュー） | 同じcommitを利用。連続シャッフルは `coalesce` で1つのUndo単位に統合 |
| テスト | Vitest（node, fake-indexeddb）184件、Playwright 37件（ローカルfixture・実拡張ロード） | 既存を維持し、shuffle用の単体・統合・E2Eを追加 |
| 既存指示 | AGENTS.md: 未確認セレクタ禁止、自動生成禁止、上書きは明示確認、未検証を検証済みと報告しない | ハーネスに統合（AGENTS.md / CLAUDE.md / Skill） |
| 書込み禁止状態 | 実NovelAIへの書込みは「未検証のため無効」（ADR-021/039） | 本機能でも実サイト書込みは無効のまま。fixtureでのみ書込みを検証 |

公式ドキュメント（2026-11-14確認, docs.novelai.net/en/image/…）から採用した事実: キャラクタープロンプトはV4以降、上限はV4=6人・V5=22人（V4.5は未記載）、`source#`/`target#`/`mutual#` は「常に信頼できるわけではない」、`|` 区切りはキャラクター欄が1つでもあると無効、Randomizer `||a|b||` は生成ごとに選ばれる、V4/V4.5の位置は5x5グリッド、V4/V4.5はT5トークナイザで非ASCIIが多く非対応。

## 2. レイヤとファイル

```text
src/core/shuffle/          純粋TS（DOM/Chrome API/時計/乱数APIなし）
  types.ts                 ドメイン型（CharacterDefinition, SceneTemplate, …）
  random.ts                Seeded PRNG（cyrb128 → sfc32）、step別ストリーム
  sampling.ts              Pure Random / Shuffle Bag / Weighted Random、直前回避
  assignment.ts            役割割当（二部マッチング、上限付き列挙、段階的サンプリング）
  engine.ts                1ステップの段階的抽選・制約・直近N件回避・replay
  compose.ts               プロンプト合成、モデル検証、|構文、差分、説明文
  tags.ts                  警告専用の読取りタグ抽出、カテゴリ語彙、固定タグロック
  fields.ts                論理フィールドキーと書込み計画（ベースUCは書かない）
  models.ts                公式記載に基づくモデル能力表（未記載はnull）
  generation.ts            生成ジョブ追跡・自動シャッフルカウンタ（状態機械。開始時のジョブは生成中でも基準）
  site-session.ts          （タブ, ドキュメント, プロファイル）単位の反映前原文・最後の書込み・状態不明欄
  defaults.ts / state.ts   標準テンプレート（明示操作時のみ）／不変コマンド、設定fingerprint
src/data/shuffle.ts        検証・schemaVersion移行・読込時隔離・merge・単体export/import
src/platform/novelai/      Site Adapter（セレクタはここだけ）
  protocol.ts              inspectFields/readFields/prepareFields/applyFields/generationStatus/releaseGeneration
  handler.ts               content script側: 単一ticket・事前CAS・自己書込みのみrollback・生成中拒否・lease
  client.ts                panel側: 応答のフィールド/内容/対象の照合
  adapter.ts               PromptFieldsAdapter / GenerationObserverPort（任意実装）
  dom.ts / generation.ts   検証済みprofile用 textarea adapter / DOM生成状態オブザーバ
  live.ts                  実NovelAI: ベース2欄の読取りのみ。キャラクター欄・モデル・生成検知は非対応
src/ui/Shuffle.tsx         シャッフルタブ（設定・結果・次回プレビュー・履歴）
src/ui/shuffle/            LibraryEditors / ShuffleSite（Apply・Restore・自動）/ auto-run（自動シャッフルの実行単位）/ inputs
```

依存方向: `ui → core, data, platform(client)`、`platform → core(fields/generation型)`、`data → core`。`core` は何にも依存しない。UIはDOMを走査せず、アルゴリズムを持たない（合成・抽選は全て core 呼出し）。

## 3. データフロー

```text
[Shuffle Now]                         [Apply]                                  [自動]
 core.shuffleStep(library, profile)    planFieldWrites(compose(...))            content: GenerationObserver(lease中のみ)
   → selection + 次のcursor             → client.prepareFields(target, n, w)    panel: 1秒ごと generationStatus
 core.composeShuffle(元の出典から毎回)   → 変更前後プレビュー＋編集検出            → observeStatus(counter)
 commit({coalesce}) → IDB              → 確認 → applyFields(ticket)             → 規定回数 & 非生成中 → Shuffle → prepare
 履歴にselection＋当時の出力             → 全欄readback一致 → lastWritten更新      → before≠lastWrittenなら停止 → apply
```

- 合成は常に「workspaceのcompile結果 + キャラクター定義 + selection」から行い、サイト上の既存文字列を入力にしない。よって二重適用でもタグは増えない。
- サイトへの書込みは Apply の確認、または明示的に開始した自動シャッフルからのみ。Shuffle Now・設定変更・履歴再適用はサイトを変えない。
- 復元用の反映前原文（baseline）と最後に書いた値（lastWritten）はパネルのメモリのみ。DB・JSONには保存しない（既存P2方針と同じ）。

## 4. 設計判断の要点

- **役割と構図**: Role Template と Pose Set は同一型 `SceneTemplate`（`kind` で区別）。役割ID≠キャラクターID。割当は二部マッチングで実現可能性を確認し、720通り以下は列挙して Bag 可能、超える場合は段階的サンプリング（直積を作らない）。
- **カテゴリ置換**: 各キャラクター×カテゴリに値は1つ。優先順: 役割テンプレート → ポーズセット → 個別プール → カメラプリセット → カメラ/視線プール → 可変プロンプト既定値。ユーザーの固定プロンプトは削除せず、矛盾の可能性を警告する。
- **再現性**: `stepRng(seed, step, attempt)`。cursor（step・Bag使用済み・直近署名）を保存し、同じ設定・Seed・ステップ数で同じ結果。NovelAIの生成Seedは読み書きしない。
- **Undo**: 連続したShuffle（手動・自動）は1つのUndo単位。Undoはサイトを戻さない（既存方針）。
- **破損時**: 読込時にshuffleだけ不正なら `shuffleRecovery` へ隔離して起動（ライブラリは止めない）。import時は厳格に拒否。

## 5. 追加検討事項の評価（依頼 §11）

| # | 項目 | 判断 | 理由・コスト |
|---|---|---|---|
| 1 | プリセットごとのShuffle Profile | 未実装 | プロファイルは独立に複数保存できる。プリセットsnapshotへの埋込みはDB/JSON v3の検証範囲を広げるため保留 |
| 2 | 特定キャラだけ役割固定 | **実装** | 役割の「担当できるキャラクター」制限、キャラクターの「変更を許可する項目」・固定タグ |
| 3 | A/B役割の均等出現 | **実装** | Shuffle Bagで割当を列挙して使い切る（720通りまで） |
| 4 | 直近N件の類似構図回避 | **実装（完全一致）** | 構図署名の直近N件（最大20）を最大8回の再抽選で回避。類似度（部分一致）は未実装 |
| 5 | 役割同士の組合せ禁止 | **実装（タグ制約）** | requires/excludes タグ。役割単位の直接ペア禁止UIは未実装 |
| 6 | 3人以上の部分入替 | **実装** | 役割数 < 参加人数なら一部のみ割当、残りは個別プール/既定値 |
| 7 | 標準Randomizerとの併用 | **実装（保持）** | `||…||` を改変せず通す。`|`構文時は単独`|`を検出して拒否 |
| 8 | カテゴリ別差分表示 | **実装（欄単位）** | 次回プレビューで欄ごとの差分・順序差分 |
| 9 | 履歴から再適用 | **実装** | selectionを現在にする（現在の定義で再合成）。当時の出力も表示 |
| 10 | バリエーション数の推定 | 未実装 | 制約が段階的に依存するため正確な推定は列挙が必要。低優先 |
