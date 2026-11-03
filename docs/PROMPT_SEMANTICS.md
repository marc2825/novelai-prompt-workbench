# プロンプト意味論・コメントアウトとコンパイル仕様

## 二種類の編集モード

1. **構造化モード（P1）**: ライブラリ部品を並べ、グループ単位・部品単位でON/OFF。これは確実に実装しやすい。
2. **任意テキスト編集モード（P2）**: エディタ内の選択範囲を不活性なSpanに変換（拡張側の構造）。その部分は保持するが生成テキストから除外。再ONでバイト列ではなくJavaScript文字列（Unicode）として同一に復元する。

## 出力例

入力構造:

```text
freeform: 1girl
exclusive hair [enabled]  *black hair  / blonde hair
multi outfit [enabled]     ✓school uniform  ☐white shirt
multi background [disabled] ✓city street
```

コンパイル後 positive:

```text
1girl, black hair, school uniform
```

コメントアウト状態を表す`//`や`#`をNovelAI送信欄へ足さない。無効化する対象は内部ドキュメント構造で判定し、最終出力で除外する。

## テキスト処理ルール

- raw文字列の中の `{tag}`, `[tag]`, `1.2::tag::`, `!macro:Name!`, `|` は**解釈/改変しない**。マクロ参照を解決するのはNovelAI本体であり拡張は黙って改変しない。
- raw文字列を「カンマ区切りタグ配列」と誤認しない。カンマや改行を含む自由文/ミキシングに対応するため。
- `compile(workspace)`は副作用なし。`freeformPositive`/`freeformNegative`を最初に、その後はworkspaceのgroups順に結合する。
- 部品の両端の**トリミング**と、部品境界への`, `挿入のみ許す。原文を完全無変更で出力したい高度モードは後続で`joiner`設定を追加する。末尾`,`を持つ部品には二重の`,`が生じないよう境界だけを制御する。
- 元原文は保存し、トリミングは出力時のみ。コンパイルの処理ログで無効・選択無し・参照欠落を警告可能にする。
- 実際のNovelAI構文仕様は更新され得るため、ロジックをparser依存にしない。

## 排他/複数選択の真理値表

| グループON | モード | 状態 | 出力 |
|---|---|---|---|
| OFF | どちらでも | 任意 | 無し |
| ON | multi | item.enabled=true | 対応item.raw |
| ON | multi | item.enabled=false | 無し |
| ON | exclusive | selectedMemberIdに一致 | 対応item.raw |
| ON | exclusive | selectedMemberId=null | 無し |
| ON | exclusive | selectedMemberIdが存在しない | エラー/警告、出力無し |

## 任意範囲コメント（P2）

例: `long hair, black hair, blue eyes` の `black hair`を選択しOFF → 内部的に

```json
[
  {"text":"long hair, ","enabled":true},
  {"text":"black hair","enabled":false},
  {"text":", blue eyes","enabled":true}
]
```

出力時の句読点整理は曖昧なので、単純に無効spanを消して `long hair, , blue eyes` を送ることを**許容しない**。MVP P2ではユーザーが表示を確認するか、前後が区切り文字の完全一致の場合に限り安全に整理する。パース不能箇所は「選択不可」にして、原文保持と誤った出力防止を優先する。Undo/Redoと不変条件テストを必須とする。

## ダブルクリック/ホットキー

- Space：フォーカス中の部品ON/OFF。exclusiveでは選択を設定/解除（同時選択は不可能）。
- Ctrl/Cmd+Z/Y: 拡張エディタ内のみUndo/Redo。NovelAI本体への書き込みを巻き戻すものではない。
- ショートカットはNovelAIの既存入力中には横取りしない。

## P2の範囲コメントの実装範囲

- 自由入力Positive/Negativeと、各部品の構成内原文に対応。原文は変更せず、`{ id, text, enabled }`のspan配列を別に持つ。全spanのtextを結合すると原文と常に完全一致する。
- 部分選択は単純なカンマ項目の境界のみ。語の途中、サロゲートペアの途中、空白/区切りだけ、既存OFF範囲との重複は拒否する。
- braces、brackets、数値weight `::`、pipe、macro、改行のある原文は部分境界を推測しない。全文を選択した場合のみOFF可能。P1の部品トグルは従来どおり使用できる。
- OFFで生じた境界にだけ処理を限定し、二重カンマ、先頭・末尾の不要なカンマを除く。spanを全ONへ戻すと、元の余白・改行・構文を含むJavaScript文字列に復元する。
- コメント構造がある間、元のtextareaは選択可能な読取り専用。本文を編集するには確認付きで全ONへ戻し、構造を解除する。Undoでコメント状態を復元できる。原文とspanを勝手にずらさないためのP2の制限。
- malformed spanはインポートで拒否。コンパイラにも防御を置き、不正な範囲を検出した原文は出力せず警告する。警告中はサイト反映プレビューを作成できない。
- Undo/Redoはspan状態を含む既存の最大30操作履歴を利用。コメント本文・状態は保存/JSON復元できるが、操作履歴は再起動で消える。サイトへの反映操作をUndoしたと主張しない。
