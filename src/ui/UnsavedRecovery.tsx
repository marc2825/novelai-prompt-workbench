import { exportBackup } from '../data/backup';
import { downloadText, now } from './shared';
import { message, type Workbench } from './useWorkbench';
import { InfoTip } from './InfoTip';

const time = (value: string) => { try { return new Date(value).toLocaleString(); } catch { return value; } };

/** Offers the edits a closed page could not save (issue #17). Restoring is one ordinary, undoable edit. */
export function UnsavedRecovery({ workbench, onDone }: { workbench: Workbench; onDone: (notice: string) => void }) {
  const item = workbench.unsaved[0];
  if (!item) return null;
  const { journal } = item;
  const newer = workbench.currentRevision() !== journal.baseRevision;
  const missing = journal.missingImageIds.length;
  return <section className="panel stack" role="alert" aria-label="前回の未保存の変更">
    <div className="section-title"><h2>保存されていない変更があります</h2><InfoTip label="未保存の変更">前回閉じた画面が、保存を終える前に閉じられました（{journal.reason === 'failed' ? '保存エラー中' : '保存待ち'}）。閉じる直前の内容をこのブラウザの中に一時保存していました。「復元」は通常の編集として適用されるため、「元に戻す」で戻せます。画像の原本はここに保存できないため、未保存だった画像は欠落として表示されます。</InfoTip></div>
    <p>{time(journal.savedAt)} に閉じた画面の内容です。{newer ? 'その後に別の画面で保存された内容があります。' : ''}{missing ? `画像${missing}件は原本が保存されていません。` : ''}{workbench.unsaved.length > 1 ? `（ほか${workbench.unsaved.length - 1}件）` : ''}</p>
    <div className="actions">
      <button type="button" className="primary" onClick={() => {
        if (!confirm(`${newer ? '現在保存されている内容を、' : ''}前回の画面の未保存の変更で置き換えますか？「元に戻す」で戻せます。${missing ? `\n画像${missing}件は原本がないため欠落として表示されます。` : ''}`)) return;
        if (workbench.restoreUnsaved(item.key)) onDone('前回の未保存の変更を復元しました。「元に戻す」で復元前に戻せます。');
      }}>未保存の変更を復元</button>
      <button type="button" onClick={() => { try { downloadText(exportBackup(journal.data, now()), 'spellbinder-unsaved.json'); } catch (error) { workbench.setError(message(error)); } }}>未保存の変更をJSONで保存</button>
      <button type="button" className="danger" onClick={() => { if (confirm('前回の画面の未保存の変更を破棄しますか？元に戻せません。')) { workbench.discardUnsaved(item.key); onDone('前回の未保存の変更を破棄しました。'); } }}>未保存の変更を破棄</button>
    </div>
  </section>;
}
