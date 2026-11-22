import { useMemo, useRef, useState } from 'react';
import { prepareImport } from '../data/backup';
import { countsOf, exportFullBackup, fullBackupFilename, inspectFullBackup, planFullRestore, type BackupCounts, type InspectedBackup } from '../data/full-backup';
import { downloadBlob, now } from './shared';
import { message, type Workbench } from './useWorkbench';
import { InfoTip } from './InfoTip';
import { CancelledError, decryptBackup, encryptBackup, isEncryptedBackup, MIN_PASSWORD_LENGTH, passwordProblem } from '../data/encrypted-backup';

const COUNT_LABELS: Record<keyof BackupCounts, string> = {
  libraryEntries: 'ライブラリ', categories: 'カテゴリ', workspaces: 'ワークスペース', presets: 'プリセット', experiments: 'A/B比較',
  images: '画像（メタデータ）', labExperiments: 'Experiment Lab', shuffleProfiles: 'シャッフルプロファイル', shuffleCharacters: 'シャッフルキャラクター',
  shuffleTemplates: 'シャッフルテンプレート', shuffleHistory: 'シャッフル履歴',
};
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 2 : 0)} MiB`;

/**
 * Writes a complete backup of the current screen state (issue #18: also while
 * saving fails, so unsaved edits and not-yet-stored imported images can be
 * rescued without touching the database). The snapshot is fixed when the export
 * starts (issue #20): later edits, Undo or other pages do not change it, and an
 * image whose binary cannot be found for that snapshot is listed by name.
 */
export async function saveFullBackup(workbench: Workbench, onProgress?: (text: string) => void, encryption?: { password: string; signal?: AbortSignal }): Promise<string> {
  const snapshot = workbench.latest();
  if (!snapshot) throw new Error('データを読み込めていません');
  const unsaved = workbench.storageFailed() || workbench.saving;
  const source = workbench.snapshotSource(snapshot);
  try {
    const time = now();
    const result = await exportFullBackup(snapshot, source, time, (done, total) => onProgress?.(`画像を確認中… ${done}/${total}`));
    if (encryption) {
      const encrypted = await encryptBackup(result.blob, encryption.password, { signal: encryption.signal, onProgress: (done, total) => onProgress?.(`暗号化中… ${done}/${total}`) });
      downloadBlob(encrypted, fullBackupFilename(time).replace(/\.zip$/, '-encrypted.nwbenc'));
      const names = result.missing.map(id => snapshot.images.find(image => image.id === id)?.name ?? id);
      return `パスワードで暗号化した完全バックアップを保存しました（画像原本${result.manifest.images.length}件・${mib(encrypted.size)}）。パスワードを忘れると復元できません。${unsaved ? 'まだ保存されていない変更も含めています。' : ''}${names.length ? `原本が見つからない画像: ${names.slice(0, 5).join('、')}。` : ''}`;
    }
    downloadBlob(result.blob, fullBackupFilename(time));
    const names = result.missing.map(id => snapshot.images.find(image => image.id === id)?.name ?? id);
    const missing = names.length ? `原本が見つからない画像（メタデータだけを保存。復元先では欠落と表示）: ${names.slice(0, 5).join('、')}${names.length > 5 ? ` ほか${names.length - 5}件` : ''}。` : '';
    return `完全バックアップを保存しました（画像原本${result.manifest.images.length}件・${mib(result.blob.size)}）。${unsaved ? 'まだ保存されていない変更も含めています。' : ''}${missing}${result.warnings.filter(warning => !warning.includes('メタデータだけを含めました')).join(' ')}`;
  } finally { source.done(); }
}

/** Complete backup / restore: all text assets plus original PNGs and thumbnails, verified before anything is written. */
export function FullBackup({ workbench }: { workbench: Workbench }) {
  const data = workbench.data!;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [issue, setIssue] = useState('');
  const [inspected, setInspected] = useState<{ backup: InspectedBackup; name: string; size: number; free: number | null } | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [locked, setLocked] = useState<File | null>(null); const [unlock, setUnlock] = useState('');
  const abort = useRef<AbortController | null>(null);
  const problem = encrypt ? passwordProblem(password, confirmation) : '';
  // Restoring needs a settled save. Exporting (saveFullBackup) reads a fixed snapshot and never writes, so it stays available.
  const blocked = busy || workbench.saving || !!workbench.storageError;
  const planError = useMemo(() => {
    if (!inspected) return '';
    try { prepareImport(data, inspected.backup.document.payload, mode); return ''; } catch (error) { return message(error); }
  }, [inspected, mode, data]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setIssue(''); setNotice('');
    try { await action(controller.signal); } catch (error) { setIssue(error instanceof CancelledError ? '中止しました。何も保存・変更していません' : message(error)); } finally { setBusy(false); setProgress(''); abort.current = null; }
  };
  const inspect = async (file: Blob, name: string, size: number) => {
    let backup: InspectedBackup;
    try { backup = await inspectFullBackup(file, (done, total) => setProgress(`ZIPを検証中… 画像 ${done}/${total}`)); }
    catch (error) { throw new Error(`${message(error)}。現在のデータは変更していません`); }
    let free: number | null = null;
    try { const estimate = await navigator.storage.estimate(); if (estimate.quota !== undefined && estimate.usage !== undefined) free = estimate.quota - estimate.usage; } catch { /* Estimate is optional. */ }
    setInspected({ backup, name, size, free });
    setMode('replace');
  };
  const current = countsOf(data);

  return <section className="panel stack" aria-label="完全バックアップ">
    <div className="section-title"><h2>完全バックアップ（画像原本込み・推奨）</h2><InfoTip label="完全バックアップ">ライブラリ・ワークスペース・プリセット・比較・Experiment Lab・シャッフル設定・画像メタデータに加え、画像原本とサムネイルを1つのZIPに保存します。別のChromeプロファイルや別のPCでも同じ状態に戻せます。Undo履歴とサイト連携の一時情報は含みません。ZIPは無圧縮・最大2GiBで、Experiment LabのZIP（実験の共有用）とは別の形式です。</InfoTip></div>
    <p className="hint">画像も含めてすべてを1つのZIPに保存し、別の環境でもそのまま復元できます。定期的な保存をおすすめします。<strong>暗号化しない場合、プロンプトや画像はそのまま読める状態で入ります。</strong></p>
    <div className="toolbar"><label className="inline"><input type="checkbox" checked={encrypt} disabled={busy} onChange={event => setEncrypt(event.target.checked)} />パスワードで暗号化する</label><InfoTip label="バックアップの暗号化">ファイルを人に渡す・クラウドに置くときに使います。パスワードからPBKDF2-SHA-256（60万回）で鍵を作り、AES-256-GCMで暗号化します（ブラウザ標準のWeb Crypto）。パスワードは保存しません。<strong>忘れると誰も復元できません。</strong>暗号化しないZIPは従来どおり誰でも中身を読めます。</InfoTip></div>
    {encrypt && <div className="columns">
      <label>暗号化のパスワード<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>パスワード（確認）<input type="password" autoComplete="new-password" maxLength={1024} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
    </div>}
    {encrypt && (password || confirmation) && problem && <p className="hint" role="status">{problem}</p>}
    <button type="button" className="primary" disabled={busy || !!problem} onClick={() => void run(async signal => { setNotice(await saveFullBackup(workbench, setProgress, encrypt ? { password, signal } : undefined)); if (encrypt) { setPassword(''); setConfirmation(''); } })}>{encrypt ? '暗号化して完全バックアップを保存' : '完全バックアップをZIPで保存'}</button>
    <label>完全バックアップZIPを読み込む<input type="file" accept=".zip,.nwbenc,application/zip" disabled={blocked} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      setInspected(null); setLocked(null); setUnlock('');
      if (!file) return;
      void run(async () => {
        if (isEncryptedBackup(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) { setLocked(file); return; }
        await inspect(file, file.name, file.size);
      });
    }} /></label>
    {locked && <form className="panel stack" aria-label="暗号化されたバックアップ" onSubmit={event => { event.preventDefault(); const file = locked; void run(async signal => {
      let zip: Blob;
      try { zip = await decryptBackup(file, unlock, { signal, onProgress: (done, total) => setProgress(`復号中… ${done}/${total}`) }); }
      catch (error) { if (error instanceof CancelledError) throw error; throw new Error(`${message(error)}。現在のデータは変更していません`); }
      setUnlock(''); setLocked(null);
      await inspect(zip, file.name, file.size);
    }); }}>
      <p>{locked.name} はパスワードで暗号化されています。</p>
      <label>バックアップのパスワード<input type="password" autoComplete="current-password" maxLength={1024} value={unlock} onChange={event => setUnlock(event.target.value)} /></label>
      <div className="actions"><button type="submit" className="primary" disabled={busy || !unlock}>復号して内容を確認</button><button type="button" disabled={busy} onClick={() => { setLocked(null); setUnlock(''); }}>暗号化バックアップの読込をやめる</button></div>
    </form>}
    {busy && abort.current && /暗号化中|復号中/.test(progress) && <button type="button" className="small" onClick={() => abort.current?.abort()}>暗号化・復号を中止</button>}
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
      <p className="hint">途中で失敗した場合は何も変更しません。復元後も「元に戻す」で戻せます。</p>
      {planError && <p role="alert">{planError}</p>}
      <div className="actions"><button type="button" className="primary" disabled={blocked || !!planError} onClick={() => void run(async () => {
        const backup = inspected.backup;
        if (!confirm(mode === 'replace'
          ? `現在のデータ（ライブラリ${current.libraryEntries}件・ワークスペース${current.workspaces}件・比較${current.experiments}件など）を、このバックアップの内容で全置換しますか？\n画像原本${backup.binaries.size}件も保存します。`
          : `このバックアップの内容を現在のデータに追加しますか？画像原本${backup.binaries.size}件も保存します。`)) return;
        const repository = workbench.repository.current;
        if (!repository) throw new Error('DBに接続できません');
        setProgress('画像を再確認して保存中…');
        const base = workbench.latest()!;
        const plan = planFullRestore(base, backup, mode, await repository.binaryBindings([...backup.binaries.keys()]));
        try { await workbench.restoreFull(plan.data, plan.writes, base); }
        catch (error) { throw new Error(`復元できませんでした: ${message(error)}。現在のデータは変更していません`); }
        setInspected(null);
        setNotice(`完全バックアップを復元しました（画像原本${backup.binaries.size}件）。「元に戻す」で復元前に戻せます。`);
      })}>確認して完全バックアップを復元</button><button type="button" disabled={busy} onClick={() => setInspected(null)}>完全バックアップの復元をキャンセル</button></div>
    </div>}
    {progress && <p role="status" aria-label="完全バックアップの進行状況">{progress}</p>}
    {issue && <p role="alert">{issue}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
