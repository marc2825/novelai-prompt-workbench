import { useState } from 'react';
import type { BackupDocument } from '../core/types';
import { MAX_DOCUMENT_BYTES, parseBackup } from '../data/validation';
import { message, type Workbench } from './useWorkbench';

export function Recovery({ workbench }: { workbench: Workbench }) {
  const [backup, setBackup] = useState<BackupDocument | null>(null);
  const [busy, setBusy] = useState(false);
  return <section className="panel stack" aria-label="バックアップからの復旧">
    <h2>検証済みバックアップから復旧</h2>
    <p>元のDBは自動初期化しません。正常なv1/v2/v3 JSONがある場合は、現在のデータを退避して全置換できます。画像バイナリはJSONに含みません。未知のDBバージョンは変更できません。移行に失敗した場合は復旧ファイルを退避してください。</p>
    <label>復旧用JSON<input type="file" accept=".json,application/json" disabled={busy || !workbench.repository.current} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; setBackup(null);
      if (!file) return;
      if (file.size > MAX_DOCUMENT_BYTES) { workbench.setError(`ファイルが${MAX_DOCUMENT_BYTES / 1048576}MiBを超えています`); return; }
      setBusy(true);
      void file.text().then(text => setBackup(parseBackup(text))).catch(error => workbench.setError(message(error))).finally(() => setBusy(false));
    }} /></label>
    {backup && <><p>復旧候補: ライブラリ{backup.payload.libraryEntries.length}件 / カテゴリ{backup.payload.categories.length}件 / 構成{backup.payload.workspaces.length}件 / プリセット{backup.payload.presets.length}件 / 比較{backup.payload.experiments.length}件 / 画像メタデータ{backup.payload.images.length}件</p><button type="button" disabled={busy} onClick={() => {
      if (!confirm('破損した保存データをDBに退避し、表示したバックアップで全置換しますか？')) return;
      setBusy(true);
      void workbench.recover(backup.payload).catch(error => workbench.setError(message(error))).finally(() => setBusy(false));
    }}>確認して復旧</button></>}
  </section>;
}
