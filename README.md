# NovelAI Prompt Workbench（非公式）

NovelAIの画像生成プロンプトを、部品として登録・組み合わせ・比較するためのChrome拡張機能です。サイドパネルで動き、データは自分のChromeの中にだけ保存されます。

> **非公式ツールです。** NovelAI（Anlatan Inc.）とは提携していません。画像の生成は行わず、NovelAIのページへの書き込みもしません。プロンプトはコピーしてNovelAIに貼り付けて使います。現在はベータ版（0.1.0）です。

## できること

- **ライブラリ** — よく使うタグやフレーズを、名前・カテゴリ・タグを付けて保存・検索
- **ワークスペース** — 部品をグループにまとめてON/OFFし、Positive / Negative のプロンプトを組み立てる。原文の一部だけを一時的にOFFにすることもできます
- **プリセット** — 組み合わせを保存して、ワンクリックで切り替え
- **タグの重み** — 選んだタグの重みをスライダーで調整（例: `1.4::blue eyes::`）
- **シャッフル** — キャラクターの外見はそのままに、役割・ポーズ・表情・カメラを入れ替える
- **A/B比較・Experiment Lab** — 条件を変えて手動で生成した画像を並べて比べる
- **バックアップ** — 画像も含めて1つのZIPに保存し、別のPCやChromeプロファイルに復元

## できないこと

- NovelAIのページへの書き込み、生成ボタンの操作、自動生成（意図的に無効にしています）
- NovelAIのページからの読み取りは英語・日本語表示のみ。装飾やマクロを含むプロンプトは読み取りません
- NovelAIが保存したPNGの生成情報（Prompt・Seedなど）の自動解析
- PNG以外の画像、Chrome以外のブラウザ

## インストール

Chrome Web Store・GitHub Releasesでの配布はまだありません。ソースコードからビルドします。

必要なもの: Git、Node.js 22.12以上、pnpm 10

```bash
git clone https://github.com/marc2825/novelai-prompt-workbench.git
cd novelai-prompt-workbench
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

> Node.js 25以降は Corepack が付属しません。`npm install -g pnpm@10` でpnpmを入れ、`corepack pnpm` を `pnpm` に読み替えてください。

1. Chromeで `chrome://extensions` を開き、「デベロッパーモード」をONにする
2. 「パッケージ化されていない拡張機能を読み込む」で `.output/chrome-mv3` フォルダを選ぶ
3. 拡張機能メニュー（パズルのアイコン）から **NovelAI Prompt Workbench (unofficial)** を押すとサイドパネルが開く（ピン留めがおすすめ）

更新するときは `git pull` してから同じ手順でビルドし、`chrome://extensions` で再読み込みします。

## 使い方

1. 「ワークスペース」タブで構成を作り、グループを追加する
2. 「ライブラリ」タブで部品を登録し、「構成に追加」を押す
3. 画面下の「出力プレビュー」でプロンプトをコピーし、NovelAIに貼り付けて生成する
4. よく使う組み合わせは「プリセット」に保存する

お試し用のサンプルは「設定」→「デモを追加」で入ります。各項目の横の「?」にマウスを乗せると説明が表示されます。広い画面で使いたいときは、上部の「広いタブで開く」を使ってください。

機能ごとの詳しい説明: [シャッフル](docs/shuffle/architecture.md) ・ [A/B比較](docs/AB_COMPARISON.md) ・ [Experiment Lab](docs/lab/README.md) ・ [プロンプトの扱い](docs/PROMPT_SEMANTICS.md)

## データとバックアップ

- 入力は自動で保存されます。画面上部に「保存済み · この端末のみ」と出ていれば保存済みです
- データはこのChromeプロファイルの中だけにあり、**拡張機能を削除すると消えます**
- 定期的に「設定」→「完全バックアップをZIPで保存」を実行してください。画像も含めて保存され、別の環境に復元できます（[形式と検証の詳細](docs/backup.md)）

## プライバシー

- データを外部に送信しません。アクセス解析・同期・広告もありません
- 使う権限は `sidePanel` だけです。NovelAIの画像生成ページ以外には何も読み込みません
- Cookie・ログイン情報・閲覧履歴にはアクセスしません

詳しくは [プライバシーポリシー](PRIVACY.md) を参照してください。脆弱性を見つけた場合は、公開のIssueではなく [SECURITY.md](SECURITY.md) の非公開窓口から報告してください。

## NovelAIの利用規約について

この拡張機能は、NovelAIの[利用規約](https://novelai.net/terms)を守って使ってください。**この拡張機能の説明と規約が食い違う場合は、常に規約が優先されます。** NovelAIがこの種のツールを制限した場合は、それに従ってください。規約への適合は保証しません（[確認内容](docs/security.md#novelai利用規約との関係)）。

## 開発に参加する

- [CONTRIBUTING.md](CONTRIBUTING.md) — 参加方法と守ってほしいこと
- [docs/development.md](docs/development.md) — 開発環境・テスト・ビルド
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 設計
- [tasks/STATUS.md](tasks/STATUS.md) — 現在の状態・既知の制限・今後の予定
- [CHANGELOG.md](CHANGELOG.md) — 変更履歴

## ライセンス

[MIT License](LICENSE)。同梱しているサードパーティのライセンスは [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt) を参照してください。

「NovelAI」の名称は対応するサービスを示すためだけに使っており、NovelAIによる承認や保証を意味しません。
