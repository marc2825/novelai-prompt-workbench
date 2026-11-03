import { useState } from 'react';
import type { BackupDocument } from '../core/types';
import { exportBackup, prepareImport } from '../data/backup';
import { createDemo } from '../data/demo';
import { MAX_BYTES, parseBackup, validateData } from '../data/validation';
import { downloadText, newId, now } from './shared';
import { message, type Workbench } from './useWorkbench';
import { recoveryJson } from '../data/recovery';

export function Settings({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const [document, setDocument] = useState<BackupDocument | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const busy = workbench.saving || !!workbench.storageError || reading;
  let importError = '';
  if (document) {
    try { prepareImport(data, document.payload, mode); } catch (error) { importError = message(error); }
  }
  return <div className="stack">
    <section className="panel stack"><h2>JSONバックアップ</h2><p>ライブラリ・カテゴリ・ワークスペース・プリセット・比較セッション・画像メタデータ・設定をローカルJSONに保存します。画像原本・サムネイルのバイナリは含みません。元PNGを別途保管してください。復元後の欠落は比較画面に表示します。</p>
      <button type="button" onClick={() => { try { downloadText(exportBackup(data, now()), 'nai-prompt-workbench.json'); } catch (error) { workbench.setError(message(error)); } }}>JSONをエクスポート</button>
      <p className="hint">保存失敗時も、上のボタンで画面上の作業データを退避できます。</p>
      <label>JSONをインポート<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        setDocument(null); setNotice('');
        if (!file) return;
        if (file.size > MAX_BYTES) { workbench.setError('ファイルが10MiBを超えています。元データは変更しません'); return; }
        setReading(true);
        void file.text().then(text => { setDocument(parseBackup(text)); workbench.setError(''); }).catch(error => workbench.setError(`${message(error)}。元データは変更していません`)).finally(() => setReading(false));
      }} /></label>
      {document && <div className="stack" aria-label="インポート内容プレビュー">
        <p>取込候補: ライブラリ{document.payload.libraryEntries.length}件、カテゴリ{document.payload.categories.length}件、構成{document.payload.workspaces.length}件、プリセット{document.payload.presets.length}件、比較{document.payload.experiments.length}件、画像メタデータ{document.payload.images.length}件。書出日時: {document.exportedAt}</p>
        <ul>{document.payload.libraryEntries.slice(0, 5).map(entry => <li key={entry.id}>{entry.title} — {entry.raw.slice(0, 120)}</li>)}</ul>
        <label>取込方法<select value={mode} onChange={event => setMode(event.target.value as 'merge' | 'replace')}><option value="merge">追加（ID衝突はエラー）</option><option value="replace">全置換（現在のデータをバックアップ）</option></select></label>
        <p className="hint">追加時は現在の設定を優先し、全置換時はファイルの設定を復元します。追加・置換とも直前データをDBに1世代保持します。</p>
        {importError && <p role="alert">{importError}</p>}
        <div className="actions"><button type="button" disabled={busy || !!importError} onClick={() => {
          try {
            const next = prepareImport(data, document.payload, mode);
            if (!confirm(mode === 'replace' ? '現在のテキスト資産と設定を、表示したJSONの内容で全置換しますか？' : '表示した内容を現在のデータに追加しますか？')) return;
            if (workbench.commit(next, true)) { setDocument(null); setNotice('取込を適用しました。保存状態を確認してください。Undoで戻せます。'); }
          } catch (error) { workbench.setError(`${message(error)}。元データは変更していません`); }
        }}>確認してインポート</button><button type="button" onClick={() => setDocument(null)}>取込キャンセル</button></div>
      </div>}
      <button type="button" disabled={busy} onClick={() => {
        void workbench.repository.current?.previousImport().then(previous => {
          if (!previous) { setNotice('取込前バックアップはまだありません。'); return; }
          try {
            const previousData = validateData((previous as { data?: unknown }).data);
            downloadText(exportBackup(previousData, now()), 'nai-before-import.json');
            setNotice('取込前バックアップを保存しました。JSONインポートで復元できます。');
          } catch {
            downloadText(recoveryJson(previous), 'nai-before-import-recovery.json');
            setNotice('破損レコードを含む復旧用ファイルを保存しました。data内が変更前のデータです。');
          }
        }).catch(error => workbench.setError(message(error)));
      }}>取込前バックアップを保存</button>
      <button type="button" disabled={busy} onClick={() => {
        void workbench.repository.current?.migrationBackup().then(backup => {
          if (!backup) { setNotice('移行前バックアップはありません。新規作成したDBには不要です。'); return; }
          const data = validateData((backup as { data?: unknown }).data);
          downloadText(exportBackup(data, now()), 'nai-before-migration.json');
          setNotice('移行前の資産をJSONで保存しました。現在の形式でインポートできます。');
        }).catch(error => workbench.setError(message(error)));
      }}>移行前バックアップを保存</button>
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="panel stack"><h2>デモデータ</h2><p>起動時にはサンプルを挿入しません。このボタンを押したときだけ、新しいIDでサンプルを追加します。</p><button type="button" disabled={busy} onClick={() => {
      const demo = createDemo(newId, now());
      workbench.commit(previous => ({ ...previous, libraryEntries: [...previous.libraryEntries, ...demo.libraryEntries], categories: [...previous.categories, ...demo.categories], workspaces: [...previous.workspaces, ...demo.workspaces], settings: { ...previous.settings, activeWorkspaceId: demo.settings.activeWorkspaceId } }));
    }}>デモを追加</button></section>
    <section className="panel stack"><h2>保存とプライバシー</h2><p>schemaVersion 3 / IndexedDB。旧データはバックアップ付きで移行します。データはこのChromeプロファイル内に保存されます。同期・外部送信はありません。</p><p>プリセットと範囲コメントを利用できます。実NovelAIの書込みは引き続き無効です。PNG画像・手動A/B比較を利用できます。NovelAI固有メタデータ解析は未検証です。</p></section>
  </div>;
}
