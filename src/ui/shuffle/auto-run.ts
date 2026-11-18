import type { ComposeResult } from '../../core/shuffle/compose';
import { fieldLabel, planFieldWrites } from '../../core/shuffle/fields';
import { observeStatus, resetAfterShuffle, startCounter, type AutoCounter } from '../../core/shuffle/generation';
import { afterApplyAttempt, editedFields, type SiteSession } from '../../core/shuffle/site-session';
import type { SiteClient } from '../../platform/novelai/client';
import type { Target } from '../../platform/novelai/protocol';

/** Everything an auto-shuffle run needs. Getters are read synchronously on every check, never from a stale closure. */
export interface AutoRunDeps {
  client: SiteClient;
  target: Target;
  profileId: string;
  every: number;
  /** Lease session sent to the content script. Unique per run. */
  session: string;
  /** Fingerprint of every setting that affects the next prompt, frozen when the run starts. */
  fingerprint: string;
  /** Shuffle cursor step when the run starts; only this run's own shuffles may advance it. */
  step: number;
  current: () => { fingerprint: string; step: number; blocked: string | null };
  /** Advance the shuffle once (recorded in history). Returns the composed result and the new cursor step. */
  shuffle: () => { composed: ComposeResult; step: number } | null;
  getSession: () => SiteSession;
  setSession: (change: (session: SiteSession) => SiteSession) => void;
  onProgress: (progress: { count: number; generating: boolean }) => void;
  onWritten: (fields: number) => void;
  onStop: (reason: string, isError: boolean) => void;
}

export const CONFIG_CHANGED = 'シャッフル設定・キャラクター・テンプレート・候補・ベースプロンプトのいずれかが変更されたため、自動シャッフルを停止しました。内容を確認してから開始し直してください';
export const STEP_CHANGED = '自動シャッフル中にシャッフル位置が変更された（Shuffle Now・ステップ0に戻す・元に戻す等）ため、自動シャッフルを停止しました。確認してから開始し直してください';

/**
 * One armed auto-shuffle run, bound to one target document, profile and frozen
 * configuration. `tick()` is driven by the panel's timer. Every `await` is
 * followed by an `active` check, so once `stop()` returns no new site write can
 * start; an already-sent write is still recorded so edit detection stays correct.
 */
export class AutoShuffleRun {
  private activeFlag = true;
  private ticking = false;
  private counter: AutoCounter;
  private pending: ComposeResult | null = null;
  private step: number;

  constructor(private readonly deps: AutoRunDeps) {
    this.counter = startCounter(deps.every);
    this.step = deps.step;
  }
  get active() { return this.activeFlag; }
  get busy() { return this.ticking; }

  /** Idempotent. Releases the generation lease; never writes. */
  stop(reason: string, isError = true) {
    if (!this.activeFlag) return;
    this.activeFlag = false;
    this.pending = null;
    void this.deps.client.releaseGeneration(this.deps.target, this.deps.session).catch(() => undefined);
    this.deps.onStop(reason, isError);
  }

  /** Configuration, cursor and storage checks shared by every step. Returns false (after stopping) when the run must not continue. */
  private verify(): boolean {
    if (!this.activeFlag) return false;
    const now = this.deps.current();
    if (now.blocked) { this.stop(`自動シャッフルを停止しました: ${now.blocked}`); return false; }
    if (now.fingerprint !== this.deps.fingerprint) { this.stop(CONFIG_CHANGED); return false; }
    if (now.step !== this.step) { this.stop(STEP_CHANGED); return false; }
    return true;
  }

  async tick(): Promise<void> {
    if (!this.activeFlag || this.ticking) return;
    this.ticking = true;
    const { client, target } = this.deps;
    try {
      if (!this.verify()) return;
      const result = await client.generationStatus(target, this.deps.session);
      if (!this.activeFlag) return;
      if (!result.ok || result.type !== 'generationStatus') { this.stop(`自動シャッフルを停止しました: ${result.ok ? '予期しない応答です' : result.reason}`); return; }
      if (!result.status.supported) { this.stop(`自動シャッフルを停止しました: ${result.status.reason}`); return; }
      const update = observeStatus(this.counter, result.status);
      this.counter = update.counter;
      this.deps.onProgress({ count: update.counter.count, generating: result.status.generating });
      if ((!update.due && !this.pending) || result.status.generating) return; // Never write while generating.
      if (!this.verify()) return;
      if (!this.pending) {
        const next = this.deps.shuffle();
        if (!next) { this.stop('シャッフルできないため自動シャッフルを停止しました（保存エラー・無効な設定を確認してください）'); return; }
        if (next.composed.errors.length) { this.stop(`自動シャッフルを停止しました: ${next.composed.errors[0]}`); return; }
        this.pending = next.composed;
        this.step = next.step;
      }
      await this.apply(this.pending);
    } catch {
      this.stop('サイトとの通信に失敗したため自動シャッフルを停止しました');
    } finally { this.ticking = false; }
  }

  private async apply(next: ComposeResult) {
    const { client, target } = this.deps;
    const prepared = await client.prepareFields(target, next.characters.length, planFieldWrites(next));
    if (!this.activeFlag) return;
    if (!prepared.ok) { if (prepared.code !== 'BUSY') this.stop(`自動シャッフルを停止しました: ${prepared.reason}`); return; }
    if (prepared.type !== 'prepareFields') { this.stop('自動シャッフルを停止しました: 予期しない応答です'); return; }
    const edited = editedFields(this.deps.getSession(), prepared.preview.writes);
    if (edited.length) { this.stop(`拡張の最後の書込み後にNovelAI側で編集された欄（${edited.map(change => fieldLabel(change.field)).join('、')}）があるため、上書きせず自動シャッフルを停止しました。Applyで差分を確認してください`); return; }
    // Last synchronous check before the only write of this step.
    if (!this.verify()) return;
    const applied = await client.applyFields(prepared.preview);
    // Record the outcome even if the run was stopped meanwhile: the write was already sent.
    this.deps.setSession(session => afterApplyAttempt(session, prepared.preview.writes, applied.ok && applied.type === 'applyFields' ? { ok: true, values: applied.values } : { ok: false, code: applied.ok ? 'INVALID_MESSAGE' : applied.code }));
    if (!this.activeFlag) return;
    if (!applied.ok) { if (applied.code !== 'BUSY') this.stop(`自動シャッフルを停止しました: ${applied.reason}`); return; }
    if (applied.type !== 'applyFields') { this.stop('自動シャッフルを停止しました: 予期しない応答です'); return; }
    this.pending = null;
    this.counter = resetAfterShuffle(this.counter);
    this.deps.onProgress({ count: 0, generating: false });
    this.deps.onWritten(applied.values.length);
  }
}
