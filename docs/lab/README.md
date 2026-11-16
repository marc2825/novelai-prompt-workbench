# Experiment Lab / X/Y/Z Plot

## 使い方

1. 「Experiment Lab」→「新しい実験」。現在workspace・既存presetをベースにするか、直接Prompt/UCを入力する。接続済みサイトの原文は設定内の読取り操作から明示的に取り込む。
2. テンプレートを選び、X/Y/Zの種類・値・対象タグ・出現番号を指定する。未指定軸は固定1値。例: X=blush Weight 0.5–1.5の5値、Y=smileの同じ5値、Z=Seed 1001,1002,1003なら75条件。
3. 予定枚数と「全条件プレビュー」を確認して作成。各条件は生成前に固定する。定義を変えるときは「この定義から新規作成」。複製は画像・評価を引き継がない新しい実行。
4. Condition IDを選び、Prompt/UCをコピーしてNovelAIへ貼り付け、Seed・モデル・設定を手動で合わせる。検証済profileがある環境では既存の反映プレビュー→確認→CAS/readbackを利用できる。実NovelAIは読取り専用でコピーが必要。
5. 設定を確認済みにして「生成待ち」。NovelAI上で手動生成し、ダウンロードしたPNGをそのCondition IDへ登録する。取込確認にはID/Seedを表示する。画像の並びやファイル名で条件を推測しない。「次の未実行条件」で進む。
6. X=列、Y=行、Z=ページで比較する。共通Seed・反復も別ページ。画像をクリックすると該当条件へ移動。A/B条件を選ぶと既存ビューアの同期zoom/pan・ワイプ・差分と両prompt/設定を確認できる。
7. お気に入り・評価1〜5・メモを記録し、フィルタまたは評価順リストで選別する。保存済み実験から再開できる。
8. JSON/CSV/ZIP、または選択Z/Seed/反復のグリッドPNGを保存する。「広いタブでLabを開く」は同じentrypointを広いブラウザタブで開く。

## 軸と入力

| 種類 | 指定方法 / 動作 |
|---|---|
| Tag Weight | -10〜10（Labの編集上限）。数値ラッパーに統一し、0も明示的に残す |
| Tag On/Off | `Off` / `On`。存在しないタグはOnで追加する |
| Tag Replace | 指定した完全なタグ項目を候補テキストへ置換 |
| Prompt S/R | 別指定したliteral検索語を置換。出現1から、0は全件。regex不可 |
| Tag Position | `first` / `last`。重みを含む項目全体を移動 |
| Tag Group | 候補のタググループをベース末尾へ追加。1候補にカンマを含められる |
| Prompt Variant / UC Variant | 対象channel全体を各候補へ置換 |
| Seed | 最大100桁の数字文字列。Seed軸は共通Seed群より優先 |
| Steps / Guidance / Rescale | 数値リスト・範囲・個数。モデル/Effortに応じて検証 |
| Sampler / Model | 現行Lab profileの選択肢に限定。V5 Full / Curated、High / Full Medium |
| Resolution | `1024x1024`など。64の倍数、各辺64〜2048、合計3Mpxまで（Lab上限） |
| Quality Tags | `Off` / `On`を設定として記録。タグ本文へ推測追加しない |
| Prompt Matrix | 1行またはCSVの1セルを1任意グループとして全組合せ。最大6グループ |

数値は `0.5, 1, 1.5` / `0.5-2 (+0.25)` / `0.5-2 [7]`。降順は `2-0 (-0.5)`。範囲を小数第8位で正規化し、重複・空欄・過大な展開を拒否する。
テキストは既定で1行1候補。CSVなら `"rain, night",sunset` のように引用し、引用内の改行と二重引用符にも対応する。空候補は不可（タグ削除はOn/Off）。

テンプレート: Weight Sweep / Tag On/Off（2タグ）/ Tag Interaction / Seed Robustness / Prompt Comparison / Guidance Sweep / Prompt Matrix。全て編集可能。ランダムSeedはcryptoで事前生成して固定し、連続SeedはBigIntで桁落ちなく展開する。共通Seed群×反復はXYZと直積になる。

## 原文の保護

最上位のカンマ項目を括弧/numeric regionの状態付きで走査し、位置を保持する。`blush`・`{blush}`・`{{blush}}`・`[blush]`・`-3::blush::`など、単一タグを完全に囲むラッパーを置換可能。同名の出現番号を明示し、選択外の原文を維持する。削除境界のカンマだけを除く。

複数タグを囲む入れ子の内部や、`::`による未閉括弧のリセット、macro、escape、mixing、randomizerをタグ操作で推測しない。全文候補としては保持可能。複数キャラクター欄は今回の実験対象外。全文候補/SRと他の同channel文字編集の組合せ、同じタグやパラメータを複数軸で操作する設定は拒否する。XYZを順番に適用し、毎条件ベース原文から計算する。

同Seedでもpromptの変更で画像全体が変化し得る。randomizer/macroの残るベースは警告する。未展開の乱数やモデル変更を固定したとは主張しない。ピクセル差分は主観的なタグ効果の定量評価ではない。

## 連携と制約

[調査記録](RESEARCH.md)に公式資料と確認範囲を記載。V5 Full Mediumは14 Steps/Euler Ancestral固定、custom UC不可、Rescale不可。未対応軸は無効、model軸を含む各条件にも検証をかける。

実NovelAIのログイン後DOM・設定同期・生成画像捕捉は未検証。設定自動取得/適用/復元は未対応。Mode AはPrompt/UCの明示読取り、コピー、利用可能な既存profileの確認付き反映と手動生成・手動PNG取込を提供する。自動設定適用を装わない。

検証済profileで反映に成功した場合、Lab画面内では最初のサイト原文と最後の反映値をタブ/document/channel別に保持する。条件切替後も復元previewを作成できる。現在値が最後の反映値と違えば復元を中止。最終applyにもCASとreadbackを使用する。画面を閉じるとこのメモリは消える。設定の復元は記録したベース設定を参照して手動で行う。

Mode B Controlled Batchは無効。公式の許諾範囲・正式な自動生成契約・制限を確認後に別実装する。API認証、Generate操作、自動リトライはない。費用は契約/利用枠/生成条件に依存するため不明を初期値とし、利用者が公式UIで確認した単価を入力した場合のみ枚数×単価の参考値を出す。

## 保存・出力

- DB/JSON v3のoptional `lab` (`schemaVersion:1`)。既存metadata.extraに保存。旧データへ初期実験を自動挿入しない。全体backup/replace/merge/Undo/revisionの既存経路に統合する。
- 実験最大32、1実験最大512条件、全Lab最大2048条件、軸候補最大64、反復最大16。全体JSONは既存10MiB等の上限も適用。画像は1条件1PNG、複数回の画像は反復条件として管理する。
- importは定義から条件を再展開し、ID・座標・Seed・Prompt/UC・settings・factorsを照合。破損したLabは全体検証で拒否し、DBを初期化しない。復旧dump/正常backupを使用する。未知safe fieldはbackupで保持する。
- 画像原本/thumbnailは既存IndexedDB資産を共有。SHA-256重複を再利用、条件IDへ明示紐付け、quota時は未保存Blobを保持してretry。削除はUndo可能。画像資産削除時にはLab側のリンクも解除する。既存履歴/backupのpurge保護を共用。
- JSONにはmetadata・条件を含め、画像バイナリは含めない。別環境では欠落を表示し、同一PNG再取込で復旧。既存実験IDとの衝突は上書きせず拒否する。
- CSVは全条件と構造化settings/factors、評価を含み、式として解釈され得るセルの先頭を無効化する。Matrixは各候補のpresenceもfactorsに記録する。任意原文から全タグを推測抽出する機能ではなく、操作した因子と元原文から分析できる形式。
- ZIPは無圧縮ZIP32（最大128MiB/1024ファイル）、experiment.json / conditions.csv / images/{imageId}.png。元PNG欠落時は不完全なZIPを出さずエラー。ZIPの再取込は未対応で、展開後のJSONとPNGを使う。
- グリッドは8×8セルまでのページ表示、評価順リストは64件ページ。PNG出力は選択したZ/共通Seed/反復の全セルをフィルタ前で出力。画像はアスペクト比を保持、軸名は長い場合PNG内だけ省略し、完全値をJSON/CSVに保持する。
- Labの主操作は日本語/英語切替。既存SiteConnection/画像ビューア/共通アプリメニューと一部検証エラーは既存の言語を維持する。

## 今後

実機の書込みprofile・生成設定capability確認、複数キャラクター欄、モデルごとのより詳細なsampler対応、ZIPインポート、Labを含むアプリ全体の翻訳、Phase 4の正式な生成連携、高度な統計評価・最適化を別途追加できる。
