# NovelAI DOM連携を実装する前の調査メモ（実機確認必須）

この文書は**未調査のセレクタを作り込まないため**のチェックリスト。ここに既知のCSSセレクタは置かない。

## 確認手順

1. 自分のブラウザで公式 `https://novelai.net/` を開き、画像生成タブを表示。
2. 開発者ツールで positive/negativeの入力欄の要素を特定。input/textarea/contenteditable、label/role、react controlled等の挙動を記録。
3. プロンプトチャンク/複数キャラクター/UI言語切替時のDOMの変化を確認。
4. 実際に手で入力・クリアしたときに発生するinput/change等のイベントを確認。
5. **ユーザー確認のあるテスト文字列**で、書き込み→blur→再描画後に値が保たれるか確認。
6. 機能検出失敗時のreadOnlyモード、clipboardモードを検証。
7. 確認済みのスクリーンショット・検証日・対象NovelAI表示バージョンを内部の非公開テスト記録に残す。秘密情報が含まれるキャプチャはcommitしない。

## Adapterに必要な性質

- DOM要素検出は厳格。曖昧なら失敗。
- focus/current selection/selectionStartが維持できるか試す。
- 既存文字列を予想外に破壊しない。
- 反映前の状態をスナップショットとして保持し、読み戻して成功/失敗を返す。
- ブラウザタブ内の外部状態を推測して成功扱いにしない。
- 「生成」ボタン、課金ボタン、APIリクエストへの操作は実装しない。

## P2調査記録（2026-11-03 / Asia/Tokyo）

対象: 公開 `https://novelai.net/image`（タイトル `Image Generation - NovelAI`）。ログイン情報を持たない一時Chromiumプロファイルで、公開DOMを読取り専用調査。ログイン・入力・生成・API操作はしていない。製品の表示バージョン番号は確認できなかった。

確認できた構造:

```html
<div class="prompt-input-box-prompt" data-prompt-input="true">
  <!-- 中間のwrapper -->
  <div contenteditable="true" translate="no" class="ProseMirror">
    <p><br class="ProseMirror-trailingBreak"></p>
  </div>
</div>
<div class="prompt-input-box-undesired-content" data-prompt-input="true">
  <!-- 同じProseMirror構造 -->
</div>
```

画面上の `Prompt` / `Undesired Content` と対応するwrapper名を確認。表示中の2欄に加え、非表示の複製編集欄2個も存在した。textareaは非表示であり、見つかったtextareaへの安易な書込みは不適切。ハッシュclassやDOM位置はセレクタに採用していない。

- 実装: `src/platform/novelai/live.ts`。上記wrapper・data属性・ProseMirror/contenteditableを組み合わせ、**表示中の候補がチャンネルごとに一意**の場合だけ読取りを検討する。
- 単純な属性なし`p`、テキストノード、末尾の単一`br.ProseMirror-trailingBreak`のみ抽出。装飾・マクロノード・未知の構造・重複チャンネルは推測せずエラー。複数段落は改行で結ぶ。これはDOM上のテキスト投影であり、エディタ内部モデルとの完全一致を保証しない。
- 生成済みMV3拡張をロードし、実際のContent Script経由で公開ページのPositive/Negativeを自動読取り実測。両方とも空文字（0文字）を読み取れ、両方の書込み能力はfalse。サイトの入力は変更していない。
- クエリ付き`/image?…`はChromeのcontent matchで別途カバーが必要だったため`/image?*`を追加。runtimeではoriginとpathnameを再検証し、`/imagery`等は拒否する。
- 書込みアダプターは**未検証・無効**。ProseMirrorへの`textContent`/`innerHTML`代入、`execCommand`、ページ内部JSや非公開editor stateへの介入は実装していない。
- `TextareaAdapter`は検証済みprofileを明示注入するローカルReact fixture専用。profileは`src/platform/novelai/testing.ts`に分離し、製品entryからimportしない。

未確認: ログイン後のDOM、UI言語切替、Character Prompts、装飾・マクロの原文抽出、実サイトのinput/changeイベント、書込み→blur→再描画後の保持。チェックリストの書込み手順は未実施なので、実NovelAIの挿入/置換を完了扱いにしない。ユーザー確認を伴う実機検証後に別のwrite profileを追加する。

## Prompt Shuffle（2026-11-14）

実サイトへのアクセスは行っていない。次は**未調査**で、製品adapterでは扱わない（能力false）: Character Prompts欄（追加/削除ボタン・各欄のエディタ構造・UC欄）、モデル選択表示、生成ボタンの状態と完了表示、Character Positionsのキャンバス。調査・検証手順は `docs/shuffle/site-adapter.md` の「実NovelAI対応を追加する手順」。
