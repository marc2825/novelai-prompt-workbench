import { useMemo, useState } from 'react';
import { prepareImport } from '../data/backup';
import { countsOf, exportFullBackup, fullBackupFilename, inspectFullBackup, planFullRestore, type BackupCounts, type InspectedBackup } from '../data/full-backup';
import { downloadBlob, now } from './shared';
import { message, type Workbench } from './useWorkbench';

const COUNT_LABELS: Record<keyof BackupCounts, string> = {
  libraryEntries: 'ライブラリ', categories: 'カテゴリ', workspaces: 'ワークスペース', presets: 'プリセット', experiments: 'A/B比較',
  images: '画像（メタデータ）', labExperiments: 'Experiment Lab', shuffleProfiles: 'シャッフルプロファイル', shuffleCharacters: 'シャッフルキャラクター',
  shuffleTemplates: 'シャッフルテンプレート', shuffleHistory: 'シャッフル履歴',
};
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 2 : 0)} MiB`;

/** Complete backup / restore: all text assets plus original PNGs and thumbnails, verified before anything is written. */
export function FullBackup({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState('');
  const [inspected, setInspected] = useState<{ backup: InspectedBackup; name: string; size: number; free: number | null } | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const blocked = busy || workbench.saving || !!workbench.storageError;
  const planError = useMemo(() => {
    if (!inspected) return '';
    try { prepareImport(data, inspected.backup.document.payload, mode); return ''; } catch (error) { return message(error); }
  }, [inspected, mode, data]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setIssue(''); setNotice('');
    try { await action(); } catch (error) { setIssue(message(error)); } finally { setBusy(false); setProgress(''); }
  };
  const current = countsOf(data);

  return <section className="panel stack" aria-label="完全バックアップ">
    <h2>完全バックアップ（画像原本込み・推奨）</h2>
    <p>ライブラリ・ワークスペース・プリセット・比較・Experiment Lab・シャッフル設定・画像メタデータに加え、<strong>画像原本とサムネイル</strong>を1つのZIPに保存します。別のChromeプロファイルや別のPCでも同じ状態に戻せます。</p>
    <p className="hint">Undo履歴・サイト連携の一時情報は含みません。ZIPは無圧縮・最大2GiBです。Experiment LabのZIP（実験の共有用）とは別の形式です。</p>
    <button type="button" disabled={blocked} onClick={() => void run(async () => {
      const time = now();
      const result = await exportFullBackup(workbench.latest()!, { image: (id, thumbnail) => workbench.imageBlob(id, thumbnail) }, time, (done, total) => setProgress(`画像を確認中… ${done}/${total}`));
      downloadBlob(result.blob, fullBackupFilename(time));
      setNotice(`完全バックアップを保存しました（画像原本${result.manifest.images.length}件・${mib(result.blob.size)}）。${result.warnings.join(' ')}`);
    })}>完全バックアップをZIPで保存</button>
    <label>完全バックアップZIPを読み込む<input type="file" accept=".zip,application/zip" disabled={blocked} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      setInspected(null);
      if (!file) return;
      void run(async () => {
        let backup: InspectedBackup;
        try { backup = await inspectFullBackup(file, (done, total) => setProgress(`ZIPを検証中… 画像 ${done}/${total}`)); }
        catch (error) { throw new Error(`${message(error)}。現在のデータは変更していません`); }
        let free: number | null = null;
        try { const estimate = await navigator.storage.estimate(); if (estimate.quota !== undefined && estimate.usage !== undefined) free = estimate.quota - estimate.usage; } catch { /* Estimate is optional. */ }
        setInspected({ backup, name: file.name, size: file.size, free });
        setMode('replace');
      });
    }} /></label>
    {inspected && <div className="panel stack" aria-label="完全バックアップの内容プレビュー">
      <p>検証済み: {inspected.name}（{mib(inspected.size)}）。書出日時 {inspected.backup.manifest.exportedAt} / {inspected.backup.manifest.generator.name} {inspected.backup.manifest.generator.version}</p>
      <div className="table-scroll"><table><thead><tr><th>項目</th><th>現在</th><th>バックアップ</th></tr></thead><tbody>
        {(Object.keys(COUNT_LABELS) as (keyof BackupCounts)[]).map(key => <tr key={key}><td>{COUNT_LABELS[key]}</td><td>{current[key]}</td><td>{inspected.backup.manifest.counts[key]}</td></tr>)}
        <tr><td>画像原本（検証済み）</td><td>—</td><td>{inspected.backup.binaries.size}件・{mib(inspected.backup.imageBytes)}</td></tr>
      </tbody></table></div>
      {inspected.backup.warnings.map((warning, index) => <p className="hint" key={index}>⚠ {warning}</p>)}
      {inspected.free !== null && inspected.free < inspected.backup.imageBytes * 1.2 && <p role="alert">端末の保存容量が不足する可能性があります（空き約{mib(inspected.free)}）。不足した場合は何も書き込まずに中止します。</p>}
      <label>完全バックアップの復元方法<select value={mode} onChange={event => setMode(event.target.value as 'replace' | 'merge')}>
        <option value="replace">全置換（別プロファイルへの移行・完全復元。現在のデータは取込前バックアップに1世代保持）</option>
        <option value="merge">追加（現在のデータに足す。ID・画像の重複はエラー）</option>
      </select></label>
      <p className="hint">復元は1回の保存処理で行い、途中で失敗した場合は何も変更しません。復元後も「元に戻す」で復元前の状態に戻せます。</p>
      {planError && <p role="alert">{planError}</p>}
      <div className="actions"><button type="button" disabled={blocked || !!planError} onClick={() => void run(async () => {
        const backup = inspected.backup;
        if (!confirm(mode === 'replace'
          ? `現在のデータ（ライブラリ${current.libraryEntries}件・ワークスペース${current.workspaces}件・比較${current.experiments}件など）を、このバックアップの内容で全置換しますか？\n画像原本${backup.binaries.size}件も保存します。`
          : `このバックアップの内容を現在のデータに追加しますか？画像原本${backup.binaries.size}件も保存します。`)) return;
        const repository = workbench.repository.current;
        if (!repository) throw new Error('DBに接続できません');
        setProgress('画像を再確認して保存中…');
        const plan = planFullRestore(workbench.latest()!, backup, mode, await repository.binaryBindings([...backup.binaries.keys()]));
        try { await workbench.restoreFull(plan.data, plan.writes); }
        catch (error) { throw new Error(`復元できませんでした: ${message(error)}。現在のデータは変更していません`); }
        setInspected(null);
        setNotice(`完全バックアップを復元しました（画像原本${backup.binaries.size}件）。「元に戻す」で復元前に戻せます。`);
      })}>確認して完全バックアップを復元</button><button type="button" disabled={busy} onClick={() => setInspected(null)}>完全バックアップの復元をキャンセル</button></div>
    </div>}
    {progress && <p role="status" aria-label="完全バックアップの進行状況">{progress}</p>}
    {issue && <p role="alert">{issue}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
