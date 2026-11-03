# 安全性と規約の運用ルール

- 本製品は非公式拡張。NovelAIの公式アカウントや認証処理に手を出さない。
- 使用者が手動で画像生成する。拡張はプロンプト文字列を作るだけ。生成ボタンを連続/自動で押さない。
- NovelAI APIドキュメントが存在しても、新規のAPIクライアントは本仕様外。仕様と利用規約の確認を実装着手条件とする。
- Chrome extension host permissionは確認済みのNovelAIのオリジンだけ。`<all_urls>`やhistory/cookies/webRequestを安易に要求しない。
- Content ScriptはISOLATED world原則。イベント/メッセージの入力を必ず検証。非NovelAIのタブでは機能しない。
- 保存はローカル、外部分析/同期/クラッシュ送信/ログ送信をデフォルト導入しない。
- ユーザー生成画像、プロンプト（センシティブな内容を含み得る）のログ出力は最小化。
- import: サイズ上限、スキーマ検証、圧縮爆弾対策、破損画像拒否。画像メタデータをHTML描画しない。
- ユーザーの既存NovelAIプロンプトの上書きは差分プレビュー＋明示確認。前提条件と違えば何もしない。
- 不正な依存ライブラリに備え、lockfileとCIを維持。

## 参照

- NovelAI Terms https://novelai.net/terms
- NovelAI API https://image.novelai.net/docs/index.html
- Chrome side panel https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome extension storage https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
