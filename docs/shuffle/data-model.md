# Prompt Shuffle — データモデル

正本は `src/core/shuffle/types.ts`、検証は `src/data/shuffle.ts`。この文書と同期すること。

## 保存場所とバージョン

- `WorkbenchData.shuffle?: ShuffleData`（省略＝空）。DB/JSON の全体 schemaVersion は **3 のまま**で、`ShuffleData.schemaVersion`（現在 **1**）を独立に持つ。IndexedDB上は既存の `metadata.extra` に入り、他資産と同じトランザクション・revision・Undo・JSONバックアップに乗る。
- `WorkbenchData.shuffleRecovery?: ShuffleRecovery[]`（最大5件）: 読込時に検証できなかったshuffle、または移行前のコピー。
- 旧ビルド（P4）は `shuffle` を未知の安全フィールドとして保持するが解釈しない。ダウングレード運用は対象外。

## 型（要約）

```ts
CharacterDefinition { id; name; fixedPrompt; lockedTags[]; variables: {category, prompt}[]; negativePrompt: string|null;
                      allowedCategories: ('action'|'pose'|'expression'|'gaze')[]; side: 'left'|'right'|null }
SceneTemplate      { id; name; kind: 'role'|'pose'; action; basePrompt; roles: RoleDefinition[]; tags; requires; excludes; weight; enabled }
RoleDefinition     { id; name; prompt; categories[]; interaction: 'source'|'target'|'mutual'|null; side; allowedCharacterIds: string[]|null }
OptionPool         { id; name; category; characterIds: string[]|null; options: PromptOption[] }
PromptOption       { id; prompt; tags; requires; excludes; weight; enabled }
CameraPreset       { id; name; parts: {category: angle|framing|view|gaze, prompt}[]; tags; requires; excludes; weight; enabled }
ShuffleProfile     { id; name; characterIds[]; settings: ShuffleSettings; cursor: ShuffleCursor; current: ShuffleSelection|null }
ShuffleSettings    { enabled; targets{role,pose,expression,camera,position}; mode: random|bag|weighted; avoidRepeat; avoidRecent(0–20);
                     seed; model: unknown|v3|v4|v4.5|v5; outputMode: fields|pipe; autoEvery: number|null; positionHints{left,right} }
ShuffleCursor      { step; axes: {key, fingerprint, used[], last}[]; recent: string[] }
ShuffleSelection   { seed; step; roleTemplateId; roleAssignments{roleId,characterId}[]; poseTemplateId; poseAssignments[];
                     cameraPresetId; cameraCharacterIds[]; picks{poolId, characterId|null, optionId}[]; order[]; sides[]; signature }
ShuffleHistoryEntry{ id; profileId; createdAt; trigger: manual|auto|manual-count; selection; composed: ComposedSnapshot }
```

依頼にある概念との対応: RoleAssignment = `roleAssignments`/`poseAssignments`、ShuffleResult = `ShuffleSelection` + 合成結果 `ComposeResult`、GenerationJobState = `TrackerState`/`AutoCounter`/`GenerationStatus`（`core/shuffle/generation.ts`、永続化しない）、SiteCapabilities = `FieldsInspection`（`platform/novelai/protocol.ts`、永続化しない）。

## カテゴリと固定/可変の境界

| 区分 | 出力先 | シャッフルでの扱い |
|---|---|---|
| `fixedPrompt` | キャラクター欄の先頭 | 常にそのまま。変更・削除しない |
| `lockedTags` | fixedPromptの直後（fixedに同じ単純タグがあれば重複しない） | 常に出力。語彙に含むカテゴリ（例: sitting→pose）をロック |
| `variables[category]` | シャッフル値の後 | そのカテゴリをシャッフルが決めた場合だけ省略（置換）。決めなければ出力 |
| 役割/ポーズ/プール/カメラ視線 | キャラクター欄 | カテゴリごとに1つ。`allowedCategories` 外・ロック中は割り当てない |
| カメラ（angle/framing/view）、テンプレートの `basePrompt` | ベースPrompt（workspace出力の後） | カテゴリごとに1つ |
| ベース Undesired Content | — | 読まず書かない（workspace出力のまま） |
| `negativePrompt` | キャラクターUC | `null` なら書込み対象外 |

出力順: キャラクター = fixed → locked → 役割（+生成した`interaction#action`）→ ポーズセット → プール → カメラ視線 → 未置換の可変 → 位置補助テキスト。結合は既存 `appendFragment`（前後trimと境界の`, `のみ。原文は分解しない）。

## 不変条件（検証で保証）

1. ID は UUID で、shuffle内（キャラクター・テンプレート・役割・プール・候補・カメラ・プロファイル・履歴）で一意。役割IDとキャラクターIDは別名前空間として扱い、比較しない。
2. `profile.characterIds`、`role.allowedCharacterIds`、`pool.characterIds` は存在するキャラクターだけを参照。キャラクター削除時は同じコマンドで全参照を外す。
3. テンプレートは役割1〜22。カメラプリセットの同一カテゴリは1つまで。重みは 0〜1000 の有限数（NaN/負/∞は拒否、エンジン内でも0扱い）。
4. `activeProfileId` と履歴の `profileId` は存在するプロファイル。履歴は最大50件（新しい順）。プロファイル削除で履歴も削除。
5. `selection` 内の参照（テンプレート・候補）は削除済みでもよい。合成時に警告して出力から外す。再現には履歴の `composed` を使う。
6. 割当は単射（1人1役割、1役割1人）。`assignmentKey` は `roleId=characterId` 列。
7. 上限: キャラクター100、テンプレート1000、プール200、候補5000/プール、カメラ500、プロファイル50、レコード合計20000、Bag使用済み5000/軸、プロンプト10万文字。全体はJSON 10MiB以内（既存）。

## 移行・破損時の扱い

- `migrateShuffle(input, SHUFFLE_MIGRATIONS)`: `N→N+1` を順に適用。未知の将来版・手順のない版は拒否。v1が初版のため現在の登録は空（仕組みは単体テストで検証）。
- DB読込時 `quarantineShuffle`: 正常ならそのまま。移行が走ったら移行前コピーを `shuffleRecovery` に保存。検証失敗なら `shuffle` を外して `shuffleRecovery` に退避（JSON安全かつ2MiB以下なら原本、そうでなければ診断文字列）し、空の設定で起動。UIで保存・破棄できる。DBは次回保存まで変更しない。
- JSON取込（全体・シャッフル単体）は厳格検証。merge はコレクション連結でID衝突を拒否、replace は全置換。シャッフル単体exportは履歴と `current` を含めない。
