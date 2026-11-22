# インストールと更新（GitHub Releases版）

> 0.2.0 より後の版で、名前を「NovelAI Prompt Workbench」から「Spellbinder for NovelAI」に変えました。名前とZIPのファイル名が変わっただけで、データはそのまま引き継がれます（同じフォルダで更新してください）。

Node.js などの開発ツールは不要です。Chrome Web Store 版ではないため、**自動更新はありません**。

## インストール

1. [Releases](https://github.com/marc2825/spellbinder-for-novelai/releases) を開き、最新版の Assets から `spellbinder-for-novelai-<バージョン>-chrome.zip` をダウンロードします。
   - 同じ Assets にある「Source code (zip)」「Source code (tar.gz)」は、GitHubがすべてのリリースに自動で付けるソースコードです。`manifest.json` を含まず、そのままでは読み込めません（使う場合は [development.md](development.md) の手順でビルドが必要です）。
2. 置き場所になるフォルダを1つ決めて作ります。**このフォルダは更新のたびに使い回します。** バージョン番号を含まない名前にしてください。
   - 例（Windows）: `C:\Users\<ユーザー名>\ChromeExtensions\spellbinder-for-novelai`
   - 例（macOS）: `~/ChromeExtensions/spellbinder-for-novelai`
   - **0.2.0以前（旧名 NovelAI Prompt Workbench）から使っている場合は、今のフォルダ（例: `novelai-prompt-workbench`）の名前を変えずに使い続けてください。** フォルダの名前や場所を変えると、別の拡張機能として扱われ、保存したデータが表示されなくなります。
3. ZIPの中身をそのフォルダに展開します。フォルダの直下に `manifest.json` がある状態にします。Windowsのエクスプローラーで拡張子が非表示の場合は `manifest`（種類: JSON ファイル）と表示されます（展開ツールが `novelai-prompt-workbench-0.1.0-chrome` のようなフォルダを作った場合は、その**中身**を置き場所のフォルダへ移します）。
4. Chromeで `chrome://extensions` を開き、右上の「デベロッパーモード」をONにします。
5. 「パッケージ化されていない拡張機能を読み込む」を押し、置き場所のフォルダを選びます。
6. ツールバーの拡張機能メニュー（パズルのアイコン）から **Spellbinder for NovelAI (unofficial)**（0.2.0以前の名前は NovelAI Prompt Workbench） を押すと、サイドパネルが開きます。ピン留めしておくと便利です。

置き場所のフォルダは、インストール後も消したり移動したりしないでください（Chromeはこのフォルダから拡張機能を読み込み続けます）。

## 更新

1. **更新の前に**、サイドパネルの「設定」→「完全バックアップをZIPで保存」でバックアップを保存します。
2. Releases から新しいZIPをダウンロードします。
3. **前回と同じ置き場所のフォルダ**の中身をすべて削除し、新しいZIPの中身を展開します（フォルダそのものは消さず、同じ場所・同じ名前のまま使います）。
4. `chrome://extensions` を開き、Spellbinder for NovelAI（旧名 NovelAI Prompt Workbench）のカードにある再読み込みボタン（丸い矢印）を押します。
5. 開いているNovelAIのページがあれば再読み込みします。サイドパネルは開き直してください。

### なぜ同じフォルダを使うのか

パッケージ化されていない拡張機能は、**読み込んだフォルダの場所**で識別されます。別のフォルダ（たとえばバージョンごとに別名のフォルダ）から読み込むと、Chromeは別の拡張機能として扱い、保存したデータ（ライブラリ・プリセット・画像など）は**表示されません**。データが消えたわけではなく、元のフォルダから読み込んだ拡張機能の側に残っています。

誤って別のフォルダから読み込んでしまった場合:

- 元のフォルダが残っていれば、`chrome://extensions` で新しい方を削除し、元のフォルダの中身を新しいバージョンに置き換えて再読み込みします。
- 元のフォルダを消してしまった場合は、同じ場所・同じ名前でフォルダを作り直して新しいバージョンを展開し、そこから読み込み直してください。それでも元のデータが表示されない場合は、完全バックアップから復元します。

`chrome://extensions` で拡張機能を「削除」すると、その拡張機能のデータも削除されます。削除の前に必ず完全バックアップを保存してください。

## ダウンロードしたファイルの確認（任意）

各リリースには `…-chrome.zip.sha256` が付いています。ZIPと同じフォルダに置いて、次のコマンドで一致を確認できます。

```bash
# macOS / Linux
shasum -a 256 -c spellbinder-for-novelai-<バージョン>-chrome.zip.sha256
```

```powershell
# Windows (PowerShell): 表示されたハッシュが .sha256 ファイルの値と同じことを確認
Get-FileHash .\spellbinder-for-novelai-<バージョン>-chrome.zip -Algorithm SHA256
```

リリースのZIPは、公開リポジトリの GitHub Actions がタグの付いたコミットからビルドし、テストと内容の検証（権限・含まれるファイル・バージョン）を通過したものだけが添付されます。

## 知っておくこと

- Chromeを起動するたびに「デベロッパーモードの拡張機能を無効にする」という案内が出ることがあります。パッケージ化されていない拡張機能に対するChromeの標準の表示です。
- v0.x はベータ版です。大事なデータは定期的に完全バックアップを保存してください。
- NovelAIの[利用規約](https://novelai.net/terms)を守って使ってください。この拡張機能の説明と規約が食い違う場合は、規約が優先されます。

ソースコードからビルドする方法は [development.md](development.md) を参照してください。
