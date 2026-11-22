# 設計上の決定記録 (ADR)

> 文中の `codex/0x` は開発初期の指示書で、現在は `docs/archive/codex/` にあります（履歴であり現行仕様ではありません）。

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-001 | Chrome MV3 + WXT/React/TS | 拡張の保守性・Side Panel | 他ブラウザは後続 |
| ADR-002 | local-first + IndexedDB | 大量辞書/画像とプライバシー | 完全ZIPバックアップ |
| ADR-003 | コメントは内部状態 | 画像promptの未確認構文へ依存しない | 範囲OFFの境界処理 |
| ADR-004 | 排他/複数選択の明示的グループ | 予測可能なUI・安定したコンパイル | グループ間依存は後続 |
| ADR-005 | Presetはsnapshot | 後から辞書編集しても再現可能 | 同期型リンクオプションは後続 |
| ADR-006 | A/Bの生成は手動 | 規約・課金・安全性 | 公式の明示許可があれば再設計 |
| ADR-007 | DOM Adapterの動的検出と失敗時copy | サイト更新に耐える | セレクタは実機確認後 |
| ADR-008 | P1 JSONはテキストのみ | データサイズ・扱いやすさ | PNG含むZIPは後続 |
| ADR-009 | WXTのManifest自動生成 | 二重管理回避 | 出力先はビルドで確認 |
| ADR-010 | P0/P1の依存をexact版とlockfileで固定 | WXT 0.21.5 / React・React DOM 19.3.1 / TS 5.9.3 / Vite 8.3.5 / Vitest 5.1.0 / pnpm 10.34.5を実測検証 | Node 22.12+（Viteの必要版）、実測はNode 24.21.0。CIのNode 22は未実行 |
| ADR-011 | P1は設定もIndexedDBで保存 | テキスト資産・設定を単一transactionで復元し、storage権限を省く | 将来の小設定分離は必要時に検討 |
| ADR-012 | 外部DBラッパー・状態管理・schema依存は追加しない | IDB transaction、明示validator、React stateでP1を実装可能 | 容量上限付近での全量保存性能は後続評価 |
| ADR-013 | 開発依存にfake-indexeddb 6.2.7とPlaywright 1.64.1 | 前者はDB例外・rollback・競合・破損テスト、後者は実Chromium UIと拡張再起動の検証 | 実NovelAI / 手動Chromeドッキングは別確認 |
| ADR-014 | Viteを直接開発依存に追加、@types/node 22.20.5を固定 | 同じReact entryをローカルfixtureで起動、設定・テストのNode型検査。製品に追加runtime依存なし | fixtureは配布物に含めない |
| ADR-015 | 副作用なしのcontent stubのみ画像パスへ限定 | matchesは `/image` と `/image/*`、host_permissions・storage・activeTab・tabsは要求しない。生成manifestの権限はsidePanelだけ | パス適合とDOMはP2で実サイト確認 |
| ADR-016 | popupとside panelは同じentryを利用 | background workerを足さずツールバーから起動できる。WXTのentrypointは2種類のみ | 実際のside panelドッキングは手動未確認 |
| ADR-017 | 連番revision、保存キュー、配列順metadataを採用 | 連続編集の保存順を保ち、複数パネルのstale writeを拒否。IDBのキー順に影響されず復元 | 競合時の自動統合はせずJSON退避後の再読込 |
| ADR-018 | 取込は全量検証→確認→原子commit、直前状態を1世代保持 | replace/mergeの失敗時不変。未知安全フィールドを保持、ID衝突を拒否 | P3資産を含むJSON・未知版は拒否。画像は含めない |
| ADR-019 | 破壊操作に最大30操作のUndo/RedoをP1の前提として実装 | 削除・置換・構成変更を非破壊に取り消せる。原文を完全復元 | 履歴はメモリ内のみ。任意選択範囲コメントはP2 |
| ADR-020 | 壊れたDBを自動リセットしない | 復旧dump、検証済みv1バックアップからの明示復旧、書込失敗時の未保存draft exportを用意 | schemaVersion/revision自体の破損・未知DB版は自動修復しない |

P0/P1検証日: 2026-11-03（ユーザーのAsia/Tokyo日付）。Linux上のブラウザ検証ではOSを変更せず、不足共有ライブラリを`/tmp`へ展開して利用した。通常のLinux開発環境/CIでは`pnpm exec playwright install --with-deps chromium`を使用する。

## P2（2026-11-03）

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-021 | live adapterは観測済みProseMirrorの読取り専用 | 公開DOMは調査できたが、ログイン後の書込みと内部state保持は確認できない。codex/03の条件に従い未検証writeを出荷しない | 実サイト書込みprofileはTODO。公開ページの空2欄のContent Script読取りだけ自動実測 |
| ADR-022 | 接続確認はtab ID列挙と既存content scriptへのinspect | tabs/activeTab/host権限を足さずに実タブ2個の通信を検証できた。本文をinspect応答に含めず明示選択後に読む | 現在windowのみ。content注入前から開いていたページはユーザーの再読込が必要 |
| ADR-023 | 単一channelのprepare/確認/apply、60秒一回ticket | 元原文・field token・挿入範囲とdocument UUID/URL/タブIDを比較し、複数タブやSPA/再読込・DOM交換時の誤書込を防ぐ | 複数channelの一括書込はしない。ネットワークを使うAPIなし |
| ADR-024 | field native setter＋input/change＋遅延readbackは検証済みtextarea fixture専用 | React state出力、blur・強制rerender後の値保持をChromiumで実測。ProseMirrorに同じ方法を流用しない | 80msのfixture検証が実NovelAIの制御モデルを証明するわけではない |
| ADR-025 | sourceと一致するoptional span配列で範囲コメント | 既存rawを保持し、P1のDB/JSONにmigrationなしで追加。OFF解除/Undo/保存・取込で正確に復元 | P2 spanを無視する古いP1ビルドへのダウングレードは対象外 |
| ADR-026 | 範囲判定は単純カンマ項目のみ、複雑構文は全文選択のみ | パースせずに重み・macro・pipe・改行・Unicodeを保つ。曖昧な選択は拒否し、OFFに伴う境界だけ処理 | 将来の高機能エディタは後続。構造がある間は本文をreadOnlyにする |
| ADR-027 | 例外時は自分の未変更writeだけ復旧、UIにも直前原文を保持 | 別の編集を巻き戻さず、失敗時の回復用原文を残す。サイトをUndoで戻すと偽らない | 外部editorでの完全なtransaction rollbackは保証しない。自動再試行なし |
| ADR-028 | image query matchを明示追加、型検証に一致するtargetだけ送信 | 実Chromeで`/image?fixture=…`へのcontent注入と厳密schema拒否を検証して発見・修正 | 実行時もorigin/pathを検証し、`/imagery`等へは対応しない |
| ADR-029 | P2に新規依存は追加しない | 既存React/Vitest/Playwrightとnative DOM/Chrome APIだけで検証できる | テスト用profile・仮想transportは製品bundleに含めない |

## P3プリセット（2026-11-03）

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-030 | 今回はプリセットとグループ切替のみ | ユーザーの明示スコープを優先し、codex/04の画像・thumbnailは先取りしない | 画像/PNG/A-Bは未実装 |
| ADR-031 | 保存済みworkspaceの深いsnapshot、共通composeのみ使用 | 過去の選択・OFF原文・P2範囲・順序を再現し、辞書原本を変えない | 辞書最新版への自動追従なし |
| ADR-032 | snapshot内部IDはscopeを分離、適用時だけ衝突再採番 | 複数presetに同じsource IDを保持し、別live workspaceへの復元でも一意性を守る | applyは対象workspaceのID/タイトルを維持 |
| ADR-033 | workspace.appliedPresetIdと意味的dirty比較 | DB保存済みの作業とpreset未保存を区別。root identity/timeを除き全候補/原文/選択/コメントを比較 | workspace改名だけではpreset dirtyにしない |
| ADR-034 | preset選択はpreview、適用は確認付きの1 command | 差分表示・現在/適用後の両channelを確認し、未保存編集も1回のUndoで戻す | Undo履歴は既存同様メモリ内30操作 |
| ADR-035 | DB/JSON v2、v1読込みとbackup付きupgrade | preset storeを追加し、元record/metadataの退避に成功してから構造変更。失敗はv1全体にrollback | 未知DB版・壊れたv1を自動修復しない。ダウングレード未対応 |
| ADR-036 | source欠落/辞書原文変更は警告、構造破損は拒否 | 保存rawで再現できる参照と、selectedMemberId等の危険な破損を区別する | 診断は原文変更に対応。辞書名/説明のみの変更履歴は保持しない |
| ADR-037 | snapshot内preset bindingを禁止、オブジェクト循環も検出 | snapshotを別preset参照で展開しないため、循環や過剰な依存を持ち込まない | 継承・入れ子presetは未実装 |
| ADR-038 | 破損dumpは安全な診断用serializerで出力 | 循環・BigInt・過深な不正IDBでもdownloadを例外にせず、元DBを保持する | 診断markerのあるdumpは通常import対象外 |
| ADR-039 | P2 live write無効を維持、追加依存・権限なし | fixture成功を実サイト対応の根拠にしない。既存の実content script read-only E2Eも維持 | 実NovelAI write検証は別タスク |

## P4画像管理・手動A/B（2026-11-03）

今回のP4はユーザー指定の呼称で、既存codex/05のP3-Bを実装する。

| ID | 決定 | 理由・制限 |
|---|---|---|
| ADR-040 | 実験ごとにA/Bの完全snapshotとcompiled文字列を固定 | 参照元の変更・削除から独立する。presetIdは由来のみ。B再固定は明示操作、旧画像リンクを外す。現在workspaceを変更しない |
| ADR-041 | B変更案はローカル履歴で編集し、確定を1回の全体履歴に記録 | 既存Undo/P2コメントに干渉せず、確定前プレビューと取消・画面切替確認を提供。合成はcompose.tsのみ |
| ADR-042 | 不明設定はnull、Seedは数字文字列 | モデル/Seed/解像度/Steps/Sampler/Guidance/CFG Rescale/枚数/画像条件/extraを保存。extra確認や取得元が不明なら検証不能。未知の設定キーは保持して検証不能にする。記録一致も厳密再現を保証しない |
| ADR-043 | NovelAI固有metadata parserはunknown fallback | codex/05は公式保存実サンプルを実装条件にする。実サンプルが無いためキー対応を推測しない。標準PNG textの抽出、差替えinterface、明示的workbench形式の構造化parserを合成fixtureで検証。実NovelAI対応とは主張しない |
| ADR-044 | PNGだけを上限付きで取り込む。新規依存なし | 署名/CRC/チャンク/終端/寸法、展開text上限、ブラウザdecodeを検証。APNG/JPEG/WebPは拒否。安全なtextとして保持し、HTML描画しない |
| ADR-045 | DB/JSON v3。画像metadata/原本/thumbnailを分離 | SHA-256一意、256px thumbnail。v1/v2退避成功後にupgradeし、全体rollback可能。Blob再検証/hashはtransaction前、全書込みは原子的 |
| ADR-046 | JSONは明示的に画像バイナリを除外 | imageBinariesIncluded:false。別途元PNGを保存でき、復元時の欠落を診断。同一ハッシュの再取込でIDと手入力注記を維持して寸法/サイズを修復。Blobのhash/寸法bindingを読み戻し時にも照合し、同一IDの古い画像を誤表示しない。ZIP画像バックアップは今回対象外 |
| ADR-047 | Blobは削除時に即消去せず、明示purgeする | Undo/Redo/取込前backupの画像を保護。quota時は未保存Blobをメモリ保持しretry。容量はnavigator.storage.estimateの概算を表示。実ディスク満杯は未検証 |
| ADR-048 | 共通物理倍率・位置で同期表示。pixel diffに上限 | 横並び/ワイプ。4MpxまでのsRGB RGBA絶対差。寸法違いは警告し、明示選択時だけBをAへCanvas高品質補間で変形する。原本は不変 |
| ADR-049 | 画像とPromptはローカルのみ、生成はユーザー操作 | 追加通信・権限・entrypoint・依存なし。P2 live write能力falseを維持。fixture成功を実サイト検証とは扱わない |

## Prompt Shuffle（2026-11-14）

詳細は `docs/shuffle/`。

| ID | 決定 | 理由・制限 |
|---|---|---|
| ADR-050 | 既存レイヤ（core/data/platform/ui）に配置し、`src/features/` は作らない | 既存設計との整合を優先。純粋ロジックは `src/core/shuffle`、DOMは `src/platform/novelai` のみ |
| ADR-051 | Role Template と Pose Set を同一型 `SceneTemplate`（kind）で管理。役割IDとキャラクターIDを分離 | 割当の入替えを1つの仕組みで扱う。割当は二部マッチングで実現性を確認し、720通り以下だけ列挙・Bag、それ以上は段階的サンプリング（直積を作らない） |
| ADR-052 | カテゴリ単位の置換と固定/可変の分離。ユーザー記述は削除せず警告のみ | 外見と構図の混在を防ぎ、二重適用でタグを増やさない。警告用のタグ抽出は単純なカンマ項目のみ（構文は解析しない） |
| ADR-053 | cyrb128→sfc32 の自前PRNG、step別ストリーム、cursorを保存 | 依存追加なしで決定的。シャッフルSeedはNovelAIの生成Seedと独立し、生成Seedは扱わない |
| ADR-054 | `WorkbenchData.shuffle`（独立 schemaVersion 1）。DB/JSON v3は維持 | IDB store追加・DB移行なしで同一transaction/revision/Undo/JSONに乗せる。読込時の不正shuffleは `shuffleRecovery` に隔離しライブラリを止めない（既存の「破損DBを自動初期化しない」に対し、元データを保持したまま分離する例外） |
| ADR-055 | 複数欄書込みは単一ticket・書込み前の全欄CAS・自己書込みのみrollback・全欄readback | 部分成功と他者編集の上書きを防ぐ。既存の単一チャンネルprepare/applyは維持 |
| ADR-056 | 実NovelAIのキャラクター欄・モデル・生成検知・位置座標は非対応（能力false） | DOM未調査。推測セレクタを入れない。fixture profileでのみ検証し、実サイトはコピーと手動記録で代替 |
| ADR-057 | 生成回数は content script のオブザーバ（lease中のみ稼働）＋パネルのポーリングで数える | 成功ジョブをjob IDで1回だけ数え、再描画・失敗・再読込を数えない。複数パネルはleaseで排他。自動生成・Generateクリックはしない |
| ADR-058 | 連続シャッフルは1つのUndo単位（coalesce） | 自動シャッフルで30件のUndo履歴を押し流さない。Undoはサイトを戻さない |
| ADR-059 | 反映前原文・最後の書込み値はパネルのメモリのみ | 既存P2方針（サイト原文はDBに保存しない）に合わせる。パネルを閉じるとRestore不可 |

## タグ重み・画像比較UI（2026-11-16）

| ID | 決定 | 理由・制限 |
|---|---|---|
| ADR-060 | 重み編集は明示選択した単純タグ/数値重み項目だけ | ユーザー指定範囲だけ置換し、選択外の原文・空白・重複タグを保持。全体をタグ配列へ変換しない。複雑構文・コメント構造は拒否し、0〜2の編集UIに限定 |
| ADR-061 | 重みをプレビューして1操作で反映、永続化は既存rawのみ | 毎回選択時の原文から作り、ラッパーが累積しない。原文変更でプレビュー無効。既存Undo・preset・A/B snapshot・JSON経路を共用しDB版/依存/権限は追加しない |
| ADR-062 | B確定前の重みプレビューを検出し、画像比較を上部へ移す | 未反映値の取りこぼしを防ぐ。Bの再確定は旧画像リンクを解除。画像は従来どおり手動生成PNGを取り込み、重みのモデル別効果は未検証 |

## Experiment Lab（2026-11-16）

| ID | 決定 | 理由・制限 |
|---|---|---|
| ADR-063 | Lab定義・軸展開・prompt操作・固定条件をpure coreに分離 | 最大512条件、共通Seed×反復、再現可能なID。安全な最上位タグ項目のみ編集し、曖昧な入れ子は拒否 |
| ADR-064 | optional lab schemaVersion 1を既存metadata.extraへ保存 | DB v3のまま、全体backup/Undo/revision/画像storeを共用。importで全条件を再展開照合し、壊れた定義を自動採用しない |
| ADR-065 | 手動生成と明示Condition IDへのPNG登録を実装 | 実機の設定DOMは未検証。コピー・既存SiteClientのCAS/readbackのみ利用。条件切替後の復元も最後の書込み値との比較が必須。Mode Bは無効 |
| ADR-066 | 現行V5の既知Effort制約を各展開条件に検証 | Full Mediumの14 Steps/Euler Ancestral/UCなし/Rescaleなし。課金は公式UI確認値に基づく参考計算のみ |
| ADR-067 | 8×8ページ表示、既存A/B画像ビューア、依存なしZIP32出力 | 無制限DOM/Canvas/Blobメモリを避ける。ZIP128MiB、JSONは画像本体なし。実NovelAI PNG固有解析はunknownのまま |

## 監査・品質改善（2026-11-18）

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-068 | シャッフルのサイト状態を（tabId, documentId, url, profileId）単位のセッションに分離し、Mapで最大20件保持 | 単一の状態だとタブAの反映前原文がタブBのRestoreに使われ得た。破棄方式は利用者の原文を失うため、保持したまま他の対象では「コピー専用」にする | パネルを閉じると消える（DB非保存の既存方針） |
| ADR-069 | 書込み開始後の`applyFields`失敗は常に`WRITE_FAILED`。パネルは書込み前にだけ返るコード以外を「状態不明」とする | 失敗コードから「何も書いていない」を確実に判定するため。未知のコードは安全側（状態不明） | 実サイトadapterでも同じ契約を守る |
| ADR-070 | 自動シャッフルは開始時に設定fingerprintとカーソル位置を固定し、最新のコミット済みデータと毎ステップ比較して変化で停止。実行単位をReact外のクラスにし、`await`後ごとに停止確認 | 監視対象が5項目だけで、Seed・テンプレート・キャラクター・ベース等の変更が無確認で次の書込みに反映された。古いクロージャ・停止直後の未完了Promiseでの書込みを防ぐ | 実行中に変更できる設定は停止で扱う（ロックは主要ボタンのみ） |
| ADR-071 | 生成カウントは開始時に生成中のジョブも基準にし、ID無しの生成中ジョブは最初の完了までを基準とする。曖昧なら数えない | 監視開始前に始まったジョブが完了時に数えられていた。少なく数えるのは安全側 | 実サイトの完了信号は未調査 |
| ADR-072 | 完全バックアップ: 無圧縮ZIP（manifest.json＋data.json＋images/＋thumbnails/）、最大2GiB、検証→プレビュー→1トランザクションで復元 | 別プロファイルへ完全移行できる形式が無かった。無圧縮で展開処理をなくしZIP bombを排除。data.jsonは通常のJSONバックアップのまま（後方互換）。ZIPはBlob参照で組み立て、検証も1件ずつ読んでメモリを抑える | ZIP64・2GiB超、「追加」での同一画像共有は非対応 |
| ADR-073 | 復元時、同じ画像IDに別内容のバイナリが端末にあれば中止 | Undo履歴・取込前バックアップが旧バイナリを参照している可能性があり、黙って上書きすると画像が失われる | IDの付け替えによる統合は未実装 |
| ADR-074 | ツールバーボタンでサイドパネルを開く最小のbackground service workerを追加し、popupを廃止 | popupはNovelAIのページを操作すると閉じ、自動シャッフルも止まる。権限は`sidePanel`のまま（`setPanelBehavior`だけを呼ぶ） | 実ボタンのクリックは手動確認 |
| ADR-075 | 送信元URLの照合はスキーム・ホスト・パスで行い、フラグメント・クエリを許容 | 広いタブのLab（`sidepanel.html#lab`）がcontent scriptに拒否されていた | — |
| ADR-076 | 別パネル/タブの保存を`BroadcastChannel`で通知し、明示操作で読み込む（自動では読み込まない） | 広いタブ併用時に気づかず編集して競合エラーになるのを防ぐ。自動読込はUndo履歴の破棄や編集中の表示変化を伴うため利用者に選ばせる。既存の競合検出は維持 | 同時編集の自動マージは対象外 |
| ADR-077 | 保存時は（取込前バックアップ時を除き）revisionだけを読み、`validateData`が返したオブジェクトは再検証しない。開発/E2Eビルドでは検証済みデータを深く凍結 | 計測で1編集あたり検証2回・全ストア読込みがあり、2,000件で約74ms→約33ms。凍結で誤った書換えをテスト時に例外化 | Undo履歴の構造共有（約42MiB/2,000件）、差分書込みは保留 |
| ADR-078 | バージョンは`src/version.ts`に一元化（manifest・バックアップ）、package.jsonとの一致をテスト | 版の不一致を防ぐ | — |
| ADR-079 | `codex/`・完了済み`tasks/P*.md`・旧STATUSの検証ログを`docs/archive/`へ移動。READMEを利用者向けに再構成し、開発・安全・バックアップ・公開準備を個別文書に分離 | 現行仕様を知るために開発履歴を読む必要をなくす。有効な判断は各docsに統合済み | — |
| ADR-080 | ライセンスはMIT | メンテナー決定。依存のライセンスと両立し、利用・改変を広く許可する | NovelAIの名称は識別目的のみ（商標の許諾ではない） |
| ADR-081 | NovelAI利用規約（2025-12-08施行版）は拡張機能に言及がないため、規約上の禁止事項（自動化による負荷・保護回避・認証情報・サービスの複製）に該当しない読取り・コピーの範囲を維持し、実サイト書込み・自動化は無効のまま | 公式に認められた拡張ではなく、「サポートされない方法でのアクセス」等の範囲が明確でない | 一般公開前にNovelAIサポートへ確認 |
| ADR-082 | NovelAIの利用規約をこのリポジトリのすべての要件・文書・依頼より優先すると明記（README・AGENTS・security・PRIVACY・画面フッター） | 規約は拡張機能に言及しておらず、改定もありうるため、利用者と開発者（エージェント含む）の判断基準を一つにする | 規約改定時は機能の無効化・削除で対応 |
| ADR-083 | 実サイト読取りのセレクタは、観測済みの表示ラベル（英語 `prompt`/`undesired-content`、日本語 `ベースプロンプト`/`除外したい要素`）を列挙した確認済みロケール表で照合する | ラッパのクラスが表示言語に依存し、日本語UIで常に `NOT_FOUND` だった（issue #4）。DOM順・ペア構造による判別は推測を含むため採らない。未掲載の言語は安全側で失敗 | ログイン後の英語UI・他言語は未確認 |
| ADR-084 | E2Eのfixtureは開発サーバではなく、Reactの開発ビルドとして一度ビルドした静的ファイルを `node scripts/serve-fixture.mjs` で配信 | corepack非依存にし、低リソース環境でのリソース枯渇によるフレークを解消（issue #4）。開発ビルドのためStrictMode・凍結の検査は維持 | 手動確認用の `pnpm fixture`（開発サーバ）は残す |
| ADR-085 | UIを「操作と状態だけを常に表示し、説明はホバー/フォーカス/タップで出す」方針に整理（`InfoTip`/`Hint`、段階的表示、ボタンの重み付け、タブの折り返し表示と上部固定、ライト/ダークのデザイントークン） | 機能追加で説明文と操作が増え、狭いサイドパネルで縦に長く読みにくかった（400px幅でワークスペース約3900px→約2600px、設定約2250px→約1270px） | 実ブラウザでの見た目の手動確認、Experiment Labの画面は今後整理 |

## 公開リポジトリの整備（2026-11-21）

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-086 | 配布物に `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt`（React・React DOM・scheduler・Viteのpreload helper・WXT実行時コード）を同梱し、依存とライセンス本文の不一致をテストで検出 | バンドルされたMITコードのライセンス表示が配布ZIPに含まれていなかった | 実行時依存の追加時は手動更新 |
| ADR-087 | CIのトークンを `contents: read` に明示し、Actionをコミットハッシュで固定（Dependabotで更新）、checkoutの認証情報を保存しない | 公開リポジトリでのサプライチェーン対策。現在のタグと同じコミットに固定したため挙動は不変 | Dependabot・secret scanningのリポジトリ設定はメンテナーが有効化 |
| ADR-088 | Dependabotはnpmをセキュリティ更新のみ（`open-pull-requests-limit: 0`）、GitHub Actionsを月1回まとめて更新 | 個人開発で更新PRが多すぎないようにしつつ、脆弱性とハッシュ固定の陳腐化に対応 | — |
| ADR-089 | Private vulnerability reporting を有効化し、SECURITY.md・Issueテンプレートから非公開の報告窓口へ誘導 | 公開Issueに脆弱性の詳細や秘密情報が書かれるのを防ぐ | 対応時間は保証しない（個人保守） |
| ADR-090 | PRIVACY.mdを正式版にし、実装で裏付けられる内容だけを記載（通信なし、IndexedDBのみ、ページ読取りは利用者の操作時のみ） | 公開リポジトリ・将来のストア申請で参照できる文書にする | ストア用の連絡先はメンテナーが決定 |
| ADR-091 | 画面を「常に見せる操作」と「1回の操作で開く詳細」に分ける（シャッフル結果を最上部、設定・サイト反映・プリセット管理・照合情報は折りたたみ、部品編集とグループ設定はアイコン開閉、関係の薄いタブでは出力プレビューを折りたたむ） | 説明をホバーに移した後も、設定と操作が多く分かりづらいという指摘。400px幅でシャッフル約2700px→約1600px、比較約4500px→約3000px、ワークスペース約2900px→約2000px | Experiment Labの設定フォームは未整理 |
| ADR-092 | GitHub Releasesで配布: `vX.Y.Z` タグのpushで release.yml が CI（ci.ymlを再利用）→ ZIP → 検証 → SHA-256 → リリース作成。ビルドは読取り専用トークン、公開ジョブだけ `contents: write` でプロジェクトのコードを実行しない。v0.x はPre-release | Node.jsなしでインストールできるようにする。リリースがCIを迂回できず、依存やビルドのコードが公開権限に触れない構成にする | 来歴証明（attestation）は未導入 |
| ADR-093 | Releases版の更新は「同じフォルダの中身を置き換える」手順とし、manifestに `key` は入れない | unpacked拡張のIDは読み込んだフォルダのパスで決まるため、別フォルダだとデータが表示されない。`key` でIDを固定する案は、既存のソースビルド利用者のIDが変わりデータが見えなくなること、Chrome Web Store公開時に別のIDになることから採らない。E2Eで同じフォルダへの更新時のデータ保持を確認 | ストア版への移行時は完全バックアップ→復元 |

## NovelAI公式PNGメタデータ（2026-11-22、issue #25）

| ID | 決定 | 理由 | 保留点 |
|---|---|---|---|
| ADR-099 | NovelAI公式スクリプト（novelai-image-metadata、MIT）が示す入れ物の形式（PNGテキストの `Title`〜`Comment`、アルファチャンネルの `stealth_pngcomp` + ビット長 + gzip JSON）だけを読み、`ImageMetadata.novelai` に記録する。`Comment` 内の値はキー名から想定した「候補」として、型・範囲を満たすものだけを表示し、確認ダイアログを経た明示操作でのみ比較スロットの設定（`png-metadata`・追加条件は未確認）や画像のPrompt注記にする。取込時の設定は `unknown` のまま。2つの入れ物が食い違えば両方を保持し、取得元を選ばせる | 入れ物の形式は公式スクリプトで確認できるが、`Comment` の各項目の意味は公式文書に無く、実際のNovelAI画像も確認できていない（ADR-043の「推測した対応を確定値にしない」を維持）。ピクセルの展開は純粋コード（8bit RGBA・非インターレースのみ、1行ずつフィルタ解除、目印が無ければ途中で中止）にし、新しい依存は追加しない。PNGテキストの値は `texts` と重複保存せず、同一のアルファ内容も保存しない（10MiBのデータ上限を圧迫しないため）。不正な埋め込みデータは画像の取込を止めず警告にする | 実際にNovelAIで保存したPNGでの確認、項目の意味の確認。16bit・パレット・インターレースのPNGのアルファは未対応。この機能より前に取り込んだ画像のアルファチャンネルは再解析しない |
