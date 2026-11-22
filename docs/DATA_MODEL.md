# データモデル / 永続化フォーマット（v3 / P4画像・A/B）

> **名前と内部識別子**: 製品名は「Spellbinder for NovelAI」（0.2.0までは「NovelAI Prompt Workbench」）。保存データと互換性に関わる識別子は**旧名のまま変更しません**: IndexedDB名 `nai-prompt-workbench`、JSONの `format: 'nai-prompt-workbench'`、完全バックアップ `nai-prompt-workbench-full-backup`、暗号化 `nai-prompt-workbench-encrypted-backup`（先頭 `NAIWBENC`、拡張子 `.nwbenc`）、シャッフル `nai-prompt-workbench-shuffle`、未保存の退避 `nai-prompt-workbench:unsaved:`、画面のロック `nai-prompt-workbench:window:`、サイトとのプロトコル `nai-prompt-workbench/site-v1`、PNGテキストのキー `nai-prompt-workbench`。変えると既存のデータ・バックアップが読めなくなるためです。変わったのは表示名とダウンロードするファイルの名前（`spellbinder-…`）だけです。

**実装の正本は `src/core/types.ts` に置き、この文書と同期する。** 日付はISO 8601文字列、IDはUUID、Seedは整数へ丸めず文字列保存。

```ts
type Channel = 'positive' | 'negative';
interface LibraryEntry {
  id: string;
  title: string;                 // 日本語可
  raw: string;                   // NovelAIのプロンプト原文を改変せず保存
  defaultChannel: Channel;
  categoryId: string | null;
  tags: string[];
  description: string;
  previewImageIds: string[];      // 実画像は別ストア
  createdAt: string;
  updatedAt: string;
}
interface GroupMember {
  id: string;                     // 同じライブラリエントリの複数参照を許す
  entryId: string;
  enabled: boolean;              // multiのON/OFF。exclusiveでも保存可（選択ではない）
  rawSnapshot: string;           // ライブラリ変更・削除後の保険
  overrideRaw?: string;          // ワークスペース限定変更
}
interface PromptGroup {
  id: string;
  name: string;
  channel: Channel;
  mode: 'multi' | 'exclusive';
  enabled: boolean;
  members: GroupMember[];
  selectedMemberId: string | null; // exclusive用
}
interface PromptWorkspace {
  id: string;
  title: string;
  groups: PromptGroup[];        // 表示=コンパイル順（チャネルごと）
  freeformPositive: string;
  freeformNegative: string;
  updatedAt: string;
  appliedPresetId?: string;     // 適用元。snapshot内には含めない
}
interface Preset {
  id: string;
  name: string;
  sourceWorkspaceId: string;
  workspaceSnapshot: PromptWorkspace;
  createdAt: string;
  updatedAt: string;
}
interface Variant {
  id: string;
  label: 'A' | 'B';
  presetId: string | null;       // 由来。削除後もsnapshotは再現可
  workspaceSnapshot: PromptWorkspace;
  compiled: { positive: string; negative: string };
  settings: GenerationSettings;
  imageId: string | null;
}
interface GenerationSettings {
  seed: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  sampler: string | null;
  guidance: number | null;
  cfgRescale: number | null;
  imageCount: number | null;
  imageToImage: string | null;
  referenceImages: string | null;
  extrasConfirmed: boolean;
  extra: Record<string, string | number | boolean | null>;
  evidence: 'manual' | 'png-metadata' | 'unknown';
}
interface Experiment {
  id: string;
  name: string;
  variantA: Variant;
  variantB: Variant;
  createdAt: string;
  updatedAt: string;
}
```

## 必須制約

1. `GroupMember.id`はインスタンスID、`entryId`は辞書ID。両者を混同しない。
2. `exclusive`では`selectedMemberId`のみ出力対象。`multi`では`member.enabled === true`のみ。
3. `group.enabled === false`なら内部状態に関係なく出力ゼロ。再ON時には元の状態へ戻る。
4. 実際の文字列は`overrideRaw ?? rawSnapshot`で再現し、必要時だけ辞書最新版へ更新。`rawSnapshot`は適用時に必ず埋め込む。
5. PresetやVariantはsnapshotであり、元ワークスペースへの参照を通じて勝手に変化しない。
6. deleted Entryを参照するワークスペースでも既存snapshotにより復元できる。
7. 設定比較の未知値は「一致」に見なさない。

## 現在のストア

- `libraryEntries` / `categories` / `workspaces` / `presets` / `experiments` / `images` / `imageOriginals` / `imageThumbnails` / `metadata`。
- 「画像バイナリを整理」（`purgeUnreferenced`）は、現在のデータ・この画面のUndo/Redo履歴・取込前バックアップが参照しない原本とサムネイルを削除し、revisionを1つ進めます。Undo履歴は各画面のメモリにしかないため、**この拡張機能の他の画面が開いている間は実行しません**（各画面が持つWeb Lock `nai-prompt-workbench:window:<ランダムID>` で判定。判定できない環境でも実行しない）。
- 未保存の変更の一時退避（issue #17）: 保存待ち・保存中・保存エラーのまま画面が隠れる/閉じるとき、localStorageの `nai-prompt-workbench:unsaved:<画面ID>` に `{format: 'nai-prompt-workbench-unsaved', version: 1, windowId, savedAt, baseRevision, reason, missingImageIds, data}` を同期的に書きます。保存が完了すると削除します。次に開いた画面は、閉じた画面（Web Lockを持たない画面）のものだけを、取込と同じ検証（`validateData`）を通して「保存されていない変更があります」として示し、復元（通常の編集として適用、元に戻せる）・JSONで保存・破棄を選べます。保存済みデータと同じ内容・読み取れない内容は黙って削除します。画像の原本はlocalStorageに入らないため、未保存だった画像は `missingImageIds` に記録し、復元後は欠落として表示します。約450万文字を超える場合は書けません（保証範囲は下記）。
- 保存の書き方（ADR-105、形式の変更なし）: 1回の保存は1トランザクションで、revisionを確認してから書きます。同じ画面が直前にコミットした状態からの差分（消えたIDの削除と、変わったレコードの書込み）だけを書き、metadataの `settings`・`extra`・`order`・`revision` は毎回書きます。読込の直後・画像バイナリの整理の後・保存に失敗した後・取込前バックアップ付きの保存（JSONバックアップの取込・完全バックアップの復元・DB復旧）では、従来どおり全レコードを書き直します。`validateData` が返すデータは全ビルドで深く凍結され、未変更の部分は前の結果（元に戻す履歴）と共有されます。
- 保存の保証範囲: 「保存済み」は最後のIndexedDBトランザクションの完了後にだけ表示します。保存待ち・保存中に画面を閉じた場合、DBには最後に完了した保存までが残り、それ以降の変更は上記の一時退避から復元できます。一時退避も書けなかった場合（大きすぎる・ブラウザが書込みを拒否）は失われます。広いタブでは、未保存の変更があるとブラウザの「ページを離れますか」が表示されます（サイドパネルでは表示できません）。
- image binaryは原本PNGとサムネイルを別に持ち、参照カウント/削除時の孤立blobを清掃。
- 現在のJSONは `format: 'nai-prompt-workbench'`, `schemaVersion: 3`, `imageBinariesIncluded: false`, `exportedAt`, `payload: {...}`。v1/v2入力も検証・正規化して読み込み、書出しはv3。

## JSONインポートの注意

画像原本を含む完全バックアップZIPの形式と検証は [backup.md](backup.md) を参照。ZIP内の `data.json` はこの節のJSONバックアップと同一形式。

- 画像はP1のテキストJSONには**含まない**。UIにその旨明示。
- import前にサマリーを提示して`merge`/`replace`選択。初期は衝突IDへの安全なリネームもしくは明示エラーを優先。
- サイズ上限（データ本体10MiB・ファイル20MiB、[backup.md](backup.md#上限)）、レコード件数上限（10000件）、JSONの深さ制限を設定。入力のHTMLは実行しない。
- 失敗時は元のDBを変更しない。成功時だけコミット。

## P1時点の実装（DB v1）

- `Category = { id: UUID, name: string }`。削除時は対応するライブラリ項目を未分類 (`categoryId: null`) にする。部品snapshotは変更しない。
- `WorkbenchData = { libraryEntries, categories, workspaces, settings, ...safeFields }`。
- 設定は `activeWorkspaceId: UUID | null` と `librarySort: 'title' | 'updatedAt'`。P1では設定もIndexedDBに含め、1トランザクションで保存・復元する。
- DB名 `nai-prompt-workbench`、DB version / `schemaVersion` は1。P1で作成するstoreは `libraryEntries` / `categories` / `workspaces` / `metadata` のみ。後続のstoreは未作成。
- metadata: `schemaVersion`、楽観的排他用 `revision`、`settings`、安全な未知payloadフィールド `extra`、レコード配列順 `order`、取込直前の復旧データ `previousImport`（1世代）。グループ・部品順はworkspace内の配列で保持する。
- 初回起動は空。デモは設定のボタンを押したときだけ挿入する。旧版データのmigrationはまだなく、未知のDB/JSONバージョンは拒否する。将来のmigrationは実行前バックアップが必要。
- P1 JSON payloadにはカテゴリと設定を含む。スターターfixtureの省略された `categories` / `settings` だけは空配列・既定設定で補う。空の `presets` / `experiments` / `images` は保持し、実データを含むものは未対応として拒否する。
- 入力上限: UTF-8 10MiB、入れ子32、ライブラリ/カテゴリ/workspace/グループ/部品の**合計**10000レコード、1配列10000要素、JSON全体400000要素。UUID重複、構造参照切れ、型、チャンネル、選択方式、日時を検証する。
- タイトル/カテゴリ名200文字、原文100万文字、説明10000文字、タグ100件（各100文字）。原文は保存時にtrimしない。
- mergeはID衝突をエラーとし、現在の設定・既存の未知payloadフィールドを優先する。replaceは入力設定を含め全置換。いずれも確認後に変更前データを同一トランザクションで退避し、失敗時は変更しない。
- 安全な未知フィールドはpayload・レコード・設定に保持する。`__proto__` / `constructor` / `prototype` 等の危険なキー、非JSON値、過大な入力は拒否する。
- 破損時は自動削除・自動初期化しない。UIでエラーを表示し、復旧用ファイルを出力できる。schemaVersion/revisionが正常なv1 DBは、検証済みJSONから確認付きで復旧できる。未知バージョンや破損したschemaVersion/revisionは変更せず停止する。

## P2時点の追加フィールド（DB v1）

`PromptSpan = { id: UUID, text: string, enabled: boolean }`。

- workspaceに`freeformPositiveSpans?: PromptSpan[]` / `freeformNegativeSpans?: PromptSpan[]`。
- memberに`overrideSpans?: PromptSpan[]`。対応する原文は`overrideRaw ?? rawSnapshot`。
- 省略時はP1と完全に同じコンパイル。P1のDBとJSONをそのまま読み込む。DB/schemaVersionは1を維持し、store変更・migration・既存データの書換えは行わない。
- 配列が存在する場合は空配列不可。textは空文字不可、全span連結が対応原文と完全一致、disabled runの境界が安全であることを検証する。spanのUUIDも全レコードと一意であり、合計10000レコードの制限に含む。
- ON/OFFと元テキストをJSONに含め、P2のexport/importとIDB再開で復元。旧P1ビルドは追加フィールドを解釈できないため、P2で作成したコメント付きデータのダウングレード運用は対応しない。
- site document UUID、field token、確認ticket、site読取り結果/復旧用原文はパネル・Content Scriptのメモリ内のみ。DB・バックアップには自動保存しない。ユーザーの明示的な「自由入力へ取り込む」操作でだけworkspaceへコピーする。

## P3時点のプリセット（旧DB/JSON v2）

- `WorkbenchData`に`presets: Preset[]`を追加。v1では省略または空配列のみ許可していたため、旧データは空配列へ正規化する。この時点では画像・experimentsの実データは未対応だった。
- workspaceの`appliedPresetId?: UUID`は保存済みプリセットとの比較用。通常workspaceからは存在するpresetを参照する。削除時は同じ操作でbindingを解除する。
- presetの`workspaceSnapshot`は原文・自由入力・グループ/部品の順序・enabled・selectedMemberId・P2 spanを含む深いコピー。snapshotの`appliedPresetId`は禁止し、他presetへの依存を作らない。`sourceWorkspaceId === workspaceSnapshot.id`はprovenanceであり、現在のworkspaceを参照して展開しない。
- preset record IDはlive資産と一意。snapshot内部のworkspace/group/member/span IDは**snapshotごとの独立scope**で一意とする。同じsourceから保存・複製したsnapshot間でIDが一致するのは正しい。全snapshotを含む総レコード上限10000と10MiBを維持。
- 別workspaceへの適用では、対象workspaceのID・タイトルを保ち、外部live資産と衝突する内部IDだけを再採番する。selectedMemberId/spanも対応付けを保つ。新workspace復元時はroot IDを新規作成。辞書entryIdは変更しない。
- dirty比較はrootのID/タイトル/updatedAt/appliedPresetIdと内部インスタンスIDを除く。グループ順・全候補・原文・OFF状態・spanは比較する。ID再採番後も意味的に同じsnapshotは一致とする。
- 辞書の削除/原文変更、作成元workspaceの削除は診断として表示し、保存原文でコンパイルする。欠けたselectedMemberIdや不正snapshot、存在しないappliedPresetId、snapshot内preset参照、オブジェクト循環は検証で拒否。
- DB version / metadata.schemaVersionは2、storeは`libraryEntries` / `categories` / `workspaces` / `presets` / `metadata`。配列順はmetadata.orderで保持。
- v1→v2はversionchange transaction内で元の全record/metadataを読み、v1検証後に`migrationBackup:v1`へ保存完了してからpresets storeとmetadataを更新する。revisionも1増加する。失敗時はstore構成・DB version・全データをv1にrollbackする。
- migration backupは一度だけ保持し、既存previousImportバックアップは残す。設定から移行前の資産をv2 JSONとして書出し・取込可能。元metadataを含む完全な退避もDB内に保持する。失敗時の原DBはそのまま残し、読み取れた復旧用snapshotをUIから出力できる。
- 復旧dumpは通常import用JSONとは別。破損DBの循環・BigInt・非有限数・過深な構造は診断用文字列として明示する。正常な資産JSONは改変せず、不正データを自動修復して取り込まない。
- 新規DBは直接v2。未知の将来版は拒否。移行失敗時は自動初期化・自動上書きしない。旧P1/P2ビルドへのDBダウングレードには対応しない。
- 保存履歴（2026-11-22、issue #30、DB/JSON v3のまま任意フィールドとして追加）: `preset.revisions?: { id: UUID; savedAt: ISO; workspaceSnapshot }[]`（新しい順、1プリセット最大10件）。「現在の構成で上書き保存」で直前の内容を、「この版に戻す」で戻す前の内容を記録するため、明示保存した内容は失われない。revisionのIDは全体のIDスコープで一意（取込の「追加」で衝突すればエラー）、snapshotは独自のスコープで検証し、`appliedPresetId` は禁止。snapshotの `id` はその版の作成元workspace（戻すと `sourceWorkspaceId` になる）。複製では履歴をコピーしない。旧データ（フィールドなし）はそのまま有効。


## P4画像・A/B（DB/JSON v3）

- WorkbenchDataに`experiments: Experiment[]`, `images: ImageRecord[]`を追加。旧データは空配列に正規化する。v1/v2の非空images/experimentsは実装されていなかったので拒否する。
- `Experiment`はupdatedAtを追加し、A/Bそれぞれの完全workspace snapshotと合成済み両channelを保存。snapshotのappliedPresetIdは禁止、由来はvariant.presetIdに分離し、参照先削除は許容。固定文字列と共通composeの結果が一致しないimportは拒否。循環、ID重複、画像参照欠落も拒否する。
- 生成設定はnullを不明とし、Seedは数字文字列（最大100桁）。model/size/steps/sampler/guidance/cfgRescale/imageCount/img2img/reference/extraを比較する。`extrasConfirmed`は未取得の追加条件を一致扱いしないための確認。evidenceはunknown/manual/png-metadata。型を検証してから保存する。
- `ImageRecord`: UUID、SHA-256（全PNGバイト列、64桁hex、一意）、name、mime=image/png、width/height、byteLength、thumbnailBytes、createdAt、metadata。metadataはpositive/negative（null可）、promptEvidence（optional unknown/manual/png-metadata）、GenerationSettings、textsの文字列辞書、warnings。手入力注記は原本バイト列と区別して保持する。
- `images`にメタデータのみ、`imageOriginals`と`imageThumbnails`に`{id, blob, hash, width, height, byteLength, thumbnailBytes}`を保存。thumbnailは最大256px。バイナリ保存前にハッシュ/寸法/バイト数/PNG構造を再検証し、全資産・画像・revision・backupを同一transactionでcommitする。非同期hash処理はtransaction開始前。
- v1/v2→v3は元record/metadataを`migrationBackup:v1`/`:v2`へ保存した後に追加storeを作成。失敗時はversion/store/data全てrollback。旧previousImportや既存migration backupは保持する。
- Blob読取り時も現在snapshotのhash/寸法/バイト数とbindingを照合し、同一IDに違うmetadataを復元した際の古い画像の誤表示を防ぐ。不整合は欠落として通知し、同一PNG再取込で寸法/サイズを修復する。
- JSON v3は画像メタデータ・比較を含み`imageBinariesIncluded:false`。原本/thumbnailを含む形式はまだ非対応。別端末復元時の欠落はimageBlobのundefinedで検知し、同一ハッシュの再取込でIDを維持して修復。
- Undo/RedoはBlobを履歴へコピーせず、metadata/associationのみ記録する。削除後のBlobはUndo用に保持。明示purgeは現在データと全履歴、取込前backupで参照されるIDを保護する。未保存Blobは保存キュー内で保持し、quota後のretryでも再利用。
- PNG上限20MiB/各辺8192px/16,777,216px。テキストは入力・展開後とも256KiB、128チャンク、PNG全体4096チャンク。CRC、終端、圧縮方式、デコードを検査。NovelAI固有の項目は実サンプル未取得のため生成設定にしない（unknown fallback）。公式形式の入れ物は下の `metadata.novelai` に記録する。標準テキストは安全な文字列のまま保持する。

## NovelAIの画像情報（DB/JSON v3のまま追加、2026-11-22）

`ImageMetadata.novelai?: NovelAIImageInfo`（省略可）。正本は `src/core/types.ts`、検証は `validateNovelAIInfo`（`src/data/validation.ts`）。

```ts
interface NovelAIImageInfo {
  sources: ('text' | 'stealth')[];          // 1〜2件・重複なし。text=PNGテキストのComment、stealth=アルファチャンネル
  agreement: 'single' | 'match' | 'mismatch'; // 取得元1件ならsingle。2件なら全キーが一致するか
  stealth: Record<string, string> | null;   // アルファチャンネルの内容。無い場合と、PNGテキストと同一（公式キーのみ）の場合はnull
}
```

- NovelAI公式スクリプトの入れ物（PNGテキスト `Title` / `Description` / `Software` / `Source` / `Generation time` / `Comment` と、アルファチャンネルの `stealth_pngcomp`）が見つかったときだけ付く。見つからない画像・この項目より前に取り込んだ画像には無い（旧データはそのまま有効、DB/JSONのversionは変えない）。
- PNGテキストの値は従来どおり `texts` に1回だけ保存し、ここへ複製しない。アルファチャンネルの内容はPNGテキストと同一なら保存しない（`agreement: 'match'`・`stealth: null`、内容はtextsのTitle以外の公式キーと同じ）。公式キー以外を含む場合と、内容が異なる場合（`mismatch`）は保存する。黙ってどちらかを選ばない。
- 値はすべて文字列。アルファチャンネルのJSONで文字列でない値（例: `Comment` がオブジェクト）はJSON文字列にして保持し、取込時に警告を残す。
- 検証: 取得元の数と `agreement` の整合、`text` ならtextsに `Comment` があること、`stealth` の有無と取得元・一致状態の整合、キー1〜79文字・128件以下、値262,144文字以下、全体のJSON 524,288文字以下、`__proto__` 等の危険なキーと非JSON値の拒否。未知の安全なフィールドは保持する。
- `Comment` のJSONは保存時に解釈しない。表示のたびに `validateSafeJson` を通して読み、候補（型・範囲を満たす値だけ）を計算する。候補は利用者が確認ダイアログで採用したときだけ、比較スロットの `settings`（`evidence: 'png-metadata'`・`extrasConfirmed: false`・候補のない項目はnull）や画像の `positive` / `negative`（`promptEvidence: 'png-metadata'`）になる。取込時の `settings` は常に `unknown`。

- 画像の評価・タグ・メモ（2026-11-22、issue #28、任意フィールド）: `ImageRecord.review?: 'adopted' | 'pending' | 'rejected'`、`tags?: string[]`（最大20、各50文字、前後の空白・重複なし）、`note?: string`（2000文字）。値がないときはフィールドごと省く。旧データ・旧形式のバックアップはそのまま有効。

## Prompt Shuffle（DB/JSON v3のまま追加）

- `WorkbenchData.shuffle?: ShuffleData`（独自 `schemaVersion: 1`）と `shuffleRecovery?: ShuffleRecovery[]`。`metadata.extra` に保存され、同じtransaction・revision・JSONバックアップに含まれる。
- 型・不変条件・移行・隔離・merge規則は `docs/shuffle/data-model.md`、正本は `src/core/shuffle/types.ts` と `src/data/shuffle.ts`。

## Experiment Lab（DB/JSON v3内、Lab schemaVersion 1）

`WorkbenchData.lab?: LabData` はmetadata.extraに保存する。正本: `src/core/lab/types.ts`。Definitionはベース両channel・settings・XYZ Axis・共通Seedリスト・反復数・任意の参考単価。LabExperimentはUUID、Definition snapshot、条件配列、状態、日時を保持する。Condition IDは実験UUIDと決定的な展開番号の組。座標・Seed index・反復・固定Prompt/UC・settings・factor provenance、手動進捗・imageId・評価・メモを持つ。

保存前に定義から再展開して固定条件の一致を検証し、未知safe fieldは保持する。画像資産は既存images/Blob storesを共有、JSONにはmetadataのみ。旧資産形式やstore変更はなくmigrationは不要。詳細と上限は [Lab仕様](lab/README.md)。

## タグ辞書と入力補完（DB/JSON v3のまま追加、辞書 schemaVersion 1）

正本: `src/core/types.ts`（`TagDictionary` / `TagDictionaryEntry`）、`src/core/tags.ts`、検証は `src/data/validation.ts`。

```ts
interface TagDictionary { schemaVersion: 1; entries: TagDictionaryEntry[] }
interface TagDictionaryEntry {
  id: string;          // UUID。全資産と同じID空間で一意
  tag: string;         // 補完で入る表記（1〜200文字、前後空白なし）
  aliases: string[];   // 検索用の別名（日本語名・略称など）。最大20件
  note: string;        // メモ（最大1000文字、空可）
  createdAt: string;
  updatedAt: string;
}
// WorkbenchData.tagDictionary?: TagDictionary   （省略＝空）
// Settings.tagCompletion?: boolean             （省略＝ON）
```

- `WorkbenchData.tagDictionary` は省略可能。`metadata.extra` に保存され、同じtransaction・revision・JSONバックアップ（完全バックアップの `data.json`）に含まれる。storeの追加・DB版の変更・migrationはない。旧データ（フィールドなし）はそのまま有効で、勝手に作成しない。
- `settings.tagCompletion` は省略時ON。存在する場合は真偽値のみ。
- 検証: 辞書の `schemaVersion` は1のみ。項目10,000件、別名は1項目20件・合計50,000件。タグ・別名は200文字、カンマ・改行などの制御文字・`{ } [ ] | \`・`::` を含めない（重み・括弧は入力欄の原文で付ける）。日時はISO 8601。
- 一意性: 照合用の正規化（NFKCで全角→半角、小文字化、`_`→空白、空白の連続を1つ、前後の空白除去）で同じになるタグは重複としてエラー。別名は自分のタグ・自分の他の別名と同じ表記にできず、別の項目のタグとも同じにできない（別の項目どうしで同じ別名は可）。正規化した値は照合だけに使い、保存しない。
- 辞書のIDは全資産と同じID空間で重複を拒否するが、ライブラリ等の合計10,000レコードの上限には数えない（辞書は独自の10,000件上限）。10MiB・JSON要素数の上限は全体で維持。
- 取込: 全置換は入力の辞書で置換。追加は現在の項目→取込項目の順に連結し、ID衝突・同じタグ（表記ゆれを含む）・別名と他のタグの衝突はエラーで、何も変更しない。
- 完全バックアップのmanifest `counts` のキーは変えない（旧版が厳格に検証するため）。辞書の件数はプレビューで `data.json` から表示する。
- 未知の安全なフィールドは辞書・項目とも保持する。
