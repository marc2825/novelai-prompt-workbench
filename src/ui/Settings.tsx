import { useState } from 'react';
import type { BackupDocument } from '../core/types';
import { exportBackup, prepareImport } from '../data/backup';
import { createDemo } from '../data/demo';
import { MAX_BYTES, parseBackup, validateData } from '../data/validation';
import { downloadText, newId, now } from './shared';
import { message, type Workbench } from './useWorkbench';
import { recoveryJson } from '../data/recovery';
import { FullBackup } from './FullBackup';
import { InfoTip } from './InfoTip';

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
    <FullBackup workbench={workbench} />
    <section className="panel stack" aria-label="JSONバックアップ"><div className="section-title"><h2>JSONバックアップ（テキストのみ）</h2><InfoTip label="JSONバックアップ">ライブラリ・カテゴリ・ワークスペース・プリセット・比較セッション・Experiment Lab・シャッフル設定・画像メタデータ・設定をJSONに保存します。画像原本・サムネイルは含みません（画像も残すなら完全バックアップを使用）。復元後に欠けた画像は比較画面に表示され、同じPNGを再取込すると修復できます。保存エラーのときも、この書出しで画面上の作業データを退避できます。</InfoTip></div><p className="hint">画像原本を含まない軽いバックアップです。</p>
      <button type="button" onClick={() => { try { downloadText(exportBackup(data, now()), 'nai-prompt-workbench.json'); } catch (error) { workbench.setError(message(error)); } }}>JSONをエクスポート</button>
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
        <p className="hint">追加は現在の設定を優先、全置換はファイルの設定を復元します。どちらも直前のデータを1世代保持します。</p>
        {importError && <p role="alert">{importError}</p>}
        <div className="actions"><button type="button" disabled={busy || !!importError} onClick={() => {
          try {
            const next = prepareImport(data, document.payload, mode);
            if (!confirm(mode === 'replace' ? '現在のテキスト資産と設定を、表示したJSONの内容で全置換しますか？' : '表示した内容を現在のデータに追加しますか？')) return;
            if (workbench.commit(next, true)) { setDocument(null); setNotice('取込を適用しました。保存状態を確認してください。Undoで戻せます。'); }
          } catch (error) { workbench.setError(`${message(error)}。元データは変更していません`); }
        }}>確認してインポート</button><button type="button" onClick={() => setDocument(null)}>取込キャンセル</button></div>
      </div>}
      <div className="actions"><button type="button" className="small" disabled={busy} onClick={() => {
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
      <button type="button" className="small" disabled={busy} onClick={() => {
        void workbench.repository.current?.migrationBackup().then(backup => {
          if (!backup) { setNotice('移行前バックアップはありません。新規作成したDBには不要です。'); return; }
          const data = validateData((backup as { data?: unknown }).data);
          downloadText(exportBackup(data, now()), 'nai-before-migration.json');
          setNotice('移行前の資産をJSONで保存しました。現在の形式でインポートできます。');
        }).catch(error => workbench.setError(message(error)));
      }}>移行前バックアップを保存</button></div>
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="panel stack" aria-label="デモデータ"><div className="section-title"><h2>デモデータ</h2><InfoTip label="デモデータ">起動時にはサンプルを入れません。このボタンを押したときだけ、新しいIDでサンプルのライブラリと構成を追加します（既存のデータは変更しません）。</InfoTip></div><button type="button" disabled={busy} onClick={() => {
      const demo = createDemo(newId, now());
      workbench.commit(previous => ({ ...previous, libraryEntries: [...previous.libraryEntries, ...demo.libraryEntries], categories: [...previous.categories, ...demo.categories], workspaces: [...previous.workspaces, ...demo.workspaces], settings: { ...previous.settings, activeWorkspaceId: demo.settings.activeWorkspaceId } }));
    }}>デモを追加</button></section>
    <section className="panel stack" aria-label="保存とプライバシー"><div className="section-title"><h2>保存とプライバシー</h2><InfoTip label="保存とプライバシー">データはIndexedDB（schemaVersion 3）に保存され、同期・外部送信・解析送信はありません。実NovelAIへの書込みは未検証のため無効（読取りとコピーのみ）、NovelAI固有のPNGメタデータ解析は未対応です。</InfoTip></div><p className="hint">データはこのChromeプロファイルだけに保存されます。拡張機能を削除すると消えるため、完全バックアップを保存してください。</p></section>
  </div>;
}
