import { useEffect, useRef, useState } from 'react';
import { record, redo, replacePresent, startHistory, undo, type History } from '../core/history';
import type { ImageRecord, WorkbenchData } from '../core/types';
import { DATABASE_NAME, MigrationError, WorkbenchRepository } from '../data/repository';
import { validateData } from '../data/validation';
import type { ImageWrite, PreparedImage } from '../data/images';
import { journalKey, readJournals, removeJournal, sameData, writeJournal, type StoredJournal } from '../data/journal';
import { otherWindows, registerWindow, WINDOW_LOCK_PREFIX } from '../data/window-registry';
import { pinnedBinarySource, sameBinding, type BinarySource } from '../data/full-backup';

export function message(error: unknown): string { return error instanceof Error ? error.message : '不明なエラーです'; }

type StagedImage = ImageWrite & { record: PreparedImage['record'] };
const storage = (): Storage | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };
const newWindowId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function useWorkbench() {
  const [history, setHistory] = useState<History<WorkbenchData> | null>(null);
  const current = useRef<History<WorkbenchData> | null>(null);
  const repository = useRef<WorkbenchRepository | null>(null);
  const revision = useRef(0);
  const pending = useRef<{ data: WorkbenchData; backup: boolean } | null>(null);
  const running = useRef(false);
  const failed = useRef(false);
  // Image binaries imported in this page but not yet committed to IndexedDB.
  const imageWrites = useRef(new Map<string, StagedImage>());
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [migrationRecovery, setMigrationRecovery] = useState<unknown>(null);
  const [loadNotice, setLoadNotice] = useState('');
  // Consecutive coalesced commits (shuffle steps) share one undo entry.
  const coalescing = useRef(false);
  // A full restore owns the database until its single transaction settles; edits are refused meanwhile.
  const restoring = useRef(false);
  // Complete-backup exports in progress: they read binaries of a fixed snapshot, so purging must wait.
  const exporting = useRef(0);
  // Another panel/tab of this extension saved a newer revision (local BroadcastChannel; nothing leaves the browser).
  const [externalChange, setExternalChange] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const announce = () => { try { channel.current?.postMessage({ revision: revision.current }); } catch { /* Best effort only. */ } };
  // This page's identity for the presence lock and the unsaved-changes journal.
  const windowId = useRef(newWindowId());
  const journalWritten = useRef(false);
  const [unsaved, setUnsaved] = useState<StoredJournal[]>([]);

  const hasUnsavedWork = () => !!pending.current || running.current || failed.current;

  useEffect(() => {
    const presence = registerWindow(windowId.current);
    return () => presence.release();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const opened = new BroadcastChannel(`${DATABASE_NAME}:saved`);
    channel.current = opened;
    opened.onmessage = event => {
      const incoming = (event.data as { revision?: unknown } | null)?.revision;
      if (typeof incoming === 'number' && incoming > revision.current) setExternalChange(true);
    };
    return () => { opened.close(); channel.current = null; };
  }, []);

  // Issue #17: keep the last edits when the page goes away with a save queued,
  // in flight or failed. pagehide/visibilitychange allow only synchronous work,
  // so the state goes to localStorage; IndexedDB stays the source of truth.
  useEffect(() => {
    const persist = () => {
      const state = current.current?.present; const store = storage();
      if (!state || !store || !hasUnsavedWork()) return;
      const missingImageIds = state.images.filter(image => imageWrites.current.has(image.id)).map(image => image.id);
      if (writeJournal(store, { format: 'nai-prompt-workbench-unsaved', version: 1, windowId: windowId.current, savedAt: new Date().toISOString(), baseRevision: revision.current, reason: failed.current ? 'failed' : 'pending', missingImageIds, data: state })) journalWritten.current = true;
    };
    const hidden = () => { if (document.visibilityState === 'hidden') persist(); };
    // Tabs (not the side panel) can still show the browser's leave-page dialog.
    const leave = (event: BeforeUnloadEvent) => { if (hasUnsavedWork()) { persist(); event.preventDefault(); } };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', leave); };
  }, []);

  const clearOwnJournal = () => {
    const store = storage();
    if (journalWritten.current && store && !hasUnsavedWork()) { removeJournal(store, journalKey(windowId.current)); journalWritten.current = false; }
  };

  useEffect(() => {
    let cancelled = false;
    let opened: WorkbenchRepository | null = null;
    void (async () => {
      try {
        opened = await WorkbenchRepository.open();
        if (cancelled) { opened.close(); return; }
        repository.current = opened;
        const loaded = await opened.load();
        if (cancelled) return;
        revision.current = loaded.revision;
        if (loaded.notice) setLoadNotice(loaded.notice);
        current.current = startHistory(loaded.data);
        setHistory(current.current);
        // Journals of pages that are still open belong to them (their save may still finish).
        const store = storage();
        if (store) {
          let alive = new Set<string>();
          try { const snapshot = await navigator.locks?.query(); alive = new Set([...(snapshot?.held ?? [])].map(lock => lock.name ?? '').filter(name => name.startsWith(WINDOW_LOCK_PREFIX)).map(name => name.slice(WINDOW_LOCK_PREFIX.length))); } catch { /* Show every journal. */ }
          const { journals, unreadable } = readJournals(store, windowId.current);
          for (const item of unreadable) removeJournal(store, item.key);
          const left = journals.filter(item => !alive.has(item.journal.windowId));
          for (const item of left) if (sameData(item.journal.data, loaded.data)) removeJournal(store, item.key);
          if (!cancelled) setUnsaved(left.filter(item => !sameData(item.journal.data, loaded.data)));
          if (unreadable.length && !cancelled) setLoadNotice(`前回の画面の未保存データ${unreadable.length}件を読み取れなかったため削除しました。`);
        }
      } catch (cause) {
        if (!cancelled) { setStorageError(message(cause)); if (cause instanceof MigrationError) setMigrationRecovery(cause.snapshot); }
      }
    })();
    return () => { cancelled = true; opened?.close(); };
  }, []);

  const drain = async () => {
    if (running.current || failed.current || !repository.current) return;
    running.current = true;
    setSaving(true);
    try {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        const writes = [...imageWrites.current.values()];
        revision.current = await repository.current.save(next.data, revision.current, next.backup, writes);
        announce();
        for (const write of writes) if (next.data.images.some(image => image.id === write.id) && imageWrites.current.get(write.id) === write) imageWrites.current.delete(write.id);
      }
    } catch (cause) {
      failed.current = true;
      pending.current = current.current ? { data: current.current.present, backup: true } : null;
      setStorageError(message(cause));
    } finally { running.current = false; setSaving(false); clearOwnJournal(); }
  };

  const apply = (next: History<WorkbenchData>, backup: boolean) => {
    const referenced = new Set([...next.past, next.present, ...next.future].flatMap(state => state.images.map(image => image.id)));
    // Failed writes can remain staged through Undo. Release their memory once
    // they also fall out of the bounded history; in-flight saves own their copy.
    for (const id of imageWrites.current.keys()) if (!referenced.has(id)) imageWrites.current.delete(id);
    current.current = next;
    setHistory(next);
    pending.current = { data: next.present, backup: backup || (pending.current?.backup ?? false) };
    void drain();
  };

  const commit = (change: WorkbenchData | ((data: WorkbenchData) => WorkbenchData), backup = false, options: { coalesce?: boolean } = {}): boolean => {
    if (!current.current) return false;
    if (restoring.current) { setError('完全バックアップを復元中です。完了するまで編集できません'); return false; }
    try {
      const next = validateData(typeof change === 'function' ? change(current.current.present) : change);
      const merge = !!options.coalesce && coalescing.current && current.current.past.length > 0;
      coalescing.current = !!options.coalesce;
      apply(merge ? replacePresent(current.current, next) : record(current.current, next), backup);
      setError('');
      return true;
    } catch (cause) { setError(message(cause)); return false; }
  };

  // Dev/fixture builds only: the opt-in Chromium benchmark (tests/perf, `pnpm bench:chromium`)
  // drives commits through this. import.meta.env.DEV is false in the extension build, which
  // drops the body (tests/e2e/extension.spec.ts checks that the name is not shipped).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const target = window as unknown as Record<string, unknown>;
    target.__workbenchBench = {
      commit, validateData, Repository: WorkbenchRepository,
      latest: () => current.current?.present ?? null,
      undoDepth: () => current.current?.past.length ?? 0,
      idle: () => !running.current && !pending.current && !failed.current,
    };
    return () => { delete target.__workbenchBench; };
  }, []);

  /** Binary of an image record: a staged (uncommitted) import first, then IndexedDB; both must match the record. */
  const binaryFor = async (record: ImageRecord, thumbnail: boolean) => {
    const staged = imageWrites.current.get(record.id);
    if (staged && sameBinding(staged.record, record)) return thumbnail ? staged.thumbnail : staged.original;
    return repository.current?.imageBlob(record.id, thumbnail, record);
  };

  return {
    data: history?.present ?? null, saving, storageError, error, setError, commit, repository, migrationRecovery, loadNotice, setLoadNotice,
    /** Latest committed state, readable synchronously from async callbacks. */
    latest: () => current.current?.present ?? null,
    /** Whether saving has failed and is waiting for a retry, readable synchronously. */
    storageFailed: () => failed.current,
    imageBlob: async (id: string, thumbnail = false) => {
      const record = current.current?.present.images.find(image => image.id === id);
      return record ? binaryFor(record, thumbnail) : undefined;
    },
    /**
     * Issue #20: a binary source pinned to one snapshot. Staged imports are
     * captured now (later Undo/edits cannot drop them), every binary is checked
     * against the snapshot's own record, and purging waits until `done()`.
     */
    snapshotSource: (snapshot: WorkbenchData): BinarySource & { done(): void } => {
      const source = pinnedBinarySource(snapshot, imageWrites.current, async (record, thumbnail) => repository.current?.imageBlob(record.id, thumbnail, record));
      exporting.current++;
      let finished = false;
      return { image: source.image, done: () => { if (!finished) { finished = true; exporting.current--; } } };
    },
    attachImage: (prepared: PreparedImage, experimentId: string, variant: 'variantA' | 'variantB' | { conditionId: string }) => {
      const state = current.current?.present;
      if (!state || (typeof variant === 'string' ? !state.experiments.some(item => item.id === experimentId) : !state.lab?.experiments.some(item => item.id === experimentId && item.conditions.some(c => c.id === variant.conditionId)))) throw new Error('比較セッションが削除されています');
      const existing = state.images.find(image => image.hash === prepared.record.hash);
      const id = existing?.id ?? prepared.id;
      const write = { id, original: prepared.original, thumbnail: prepared.thumbnail, record: prepared.record };
      imageWrites.current.set(id, write);
      const ok = commit(data => ({ ...data, images: existing ? data.images.map(image => image.id === id ? { ...image, width: prepared.record.width, height: prepared.record.height, byteLength: prepared.record.byteLength, thumbnailBytes: prepared.record.thumbnailBytes } : image) : [...data.images, prepared.record], experiments: typeof variant === 'string' ? data.experiments.map(item => item.id === experimentId ? { ...item, updatedAt: prepared.record.createdAt, [variant]: { ...item[variant], imageId: id } } : item) : data.experiments, ...(typeof variant !== 'string' && data.lab ? { lab: { ...data.lab, experiments: data.lab.experiments.map(item => item.id === experimentId ? { ...item, updatedAt: prepared.record.createdAt, conditions: item.conditions.map(c => c.id === variant.conditionId ? { ...c, imageId: id, status: 'completed' as const, error: '' } : c) } : item) } } : {}) }));
      if (!ok) { imageWrites.current.delete(id); throw new Error('画像メタデータまたは比較の検証に失敗しました'); }
      return existing ? '同一ハッシュの画像を再利用しました。' : '画像を取り込みました。';
    },
    /**
     * Adds several prepared images as ONE edit (one Undo step), staging their binaries like
     * attachImage. Images whose SHA-256 is already in the library are skipped and reported.
     */
    addImages: (items: readonly PreparedImage[]): { added: number; duplicates: string[] } => {
      const state = current.current?.present;
      if (!state) throw new Error('データを読み込めていません');
      const known = new Set(state.images.map(image => image.hash)); const fresh: PreparedImage[] = []; const duplicates: string[] = [];
      for (const item of items) { if (known.has(item.record.hash)) { duplicates.push(item.record.name); continue; } known.add(item.record.hash); fresh.push(item); }
      if (!fresh.length) return { added: 0, duplicates };
      for (const item of fresh) imageWrites.current.set(item.id, { id: item.id, original: item.original, thumbnail: item.thumbnail, record: item.record });
      if (!commit(data => ({ ...data, images: [...data.images, ...fresh.map(item => item.record)] }))) {
        for (const item of fresh) imageWrites.current.delete(item.id);
        throw new Error('画像メタデータの検証に失敗しました（件数・容量の上限を確認してください）');
      }
      return { added: fresh.length, duplicates };
    },
    /**
     * Frees binaries no record references. Refused while this page has unsaved
     * work, an export is reading a snapshot, or another extension page is open:
     * that page's Undo/Redo could still need the binaries (issue #16).
     */
    purgeImages: async (): Promise<number> => {
      if (running.current || pending.current || failed.current || restoring.current) throw new Error('保存完了後に実行してください');
      if (exporting.current) throw new Error('完全バックアップの書出し中です。完了後に実行してください');
      if (!repository.current || !current.current) throw new Error('DBに接続できません');
      const others = await otherWindows(windowId.current);
      if (others === null) throw new Error('他の画面が開いているか確認できないため、画像バイナリの整理を中止しました（元に戻す履歴を守るため）。この拡張機能の画面を1つだけ開いて再試行してください');
      if (others > 0) throw new Error(`この拡張機能の画面が他に${others}つ開いています。他の画面の「元に戻す」で画像が戻せなくなるため、他の画面（サイドパネル・広いタブ）を閉じてから実行してください`);
      if (running.current || pending.current || failed.current) throw new Error('保存完了後に実行してください');
      const states = [...current.current.past, current.current.present, ...current.current.future];
      const result = await repository.current.purgeUnreferenced(states.flatMap(state => state.images.map(image => image.id)), revision.current);
      revision.current = result.revision;
      announce();
      return result.removed;
    },
    /**
     * Restore a complete backup in one IndexedDB transaction (data, previous-import
     * backup and every image binary). Memory and history change only after the
     * transaction commits; on any failure both the database and the screen keep
     * the previous data. The restore itself is a single Undo step. `base` is the
     * state the plan was computed from: an edit made meanwhile aborts the restore.
     */
    restoreFull: async (next: WorkbenchData, writes: ImageWrite[], base?: WorkbenchData): Promise<void> => {
      if (!repository.current || !current.current) throw new Error('DBに接続できません');
      if (running.current || pending.current || failed.current || restoring.current) throw new Error('保存が完了してから復元してください（保存エラー中は先に再試行してください）');
      if (base && current.current.present !== base) throw new Error('復元の準備中に編集されたため中止しました。もう一度「確認して完全バックアップを復元」を押してください');
      const validated = validateData(next);
      restoring.current = true; running.current = true; setSaving(true);
      try {
        revision.current = await repository.current.save(validated, revision.current, true, writes);
        announce();
        coalescing.current = false;
        current.current = record(current.current, validated);
        setHistory(current.current);
        setError('');
      } finally { restoring.current = false; running.current = false; setSaving(false); }
    },
    externalChange,
    /** Explicitly load what another panel/tab saved. Resets Undo history (it would revert the other panel's work). */
    reloadFromStorage: async () => {
      if (!repository.current) throw new Error('DBに接続できません');
      if (running.current || pending.current || failed.current || restoring.current) throw new Error('この画面の保存が終わっていないため読み込めません。必要ならJSONで退避してから再読込してください');
      const loaded = await repository.current.load();
      if (running.current || pending.current || restoring.current) throw new Error('読込中に編集されたため中止しました。もう一度お試しください');
      revision.current = loaded.revision;
      coalescing.current = false;
      current.current = startHistory(loaded.data);
      setHistory(current.current);
      setExternalChange(false);
      if (loaded.notice) setLoadNotice(loaded.notice);
    },
    /** Unsaved work left by pages that were closed before their save finished (issue #17). */
    unsaved,
    /** Applies a journal as one ordinary, undoable edit and drops it. */
    restoreUnsaved: (key: string): boolean => {
      const item = unsaved.find(value => value.key === key); if (!item) return false;
      if (!commit(item.journal.data)) return false;
      const store = storage(); if (store) removeJournal(store, key);
      setUnsaved(previous => previous.filter(value => value.key !== key));
      return true;
    },
    discardUnsaved: (key: string) => {
      const store = storage(); if (store) removeJournal(store, key);
      setUnsaved(previous => previous.filter(value => value.key !== key));
    },
    /** The revision this page last saved or loaded (to tell whether the database changed since a journal). */
    currentRevision: () => revision.current,
    canUndo: !!history?.past.length, canRedo: !!history?.future.length,
    undo: () => { if (restoring.current) return; coalescing.current = false; if (current.current?.past.length) apply(undo(current.current), false); },
    redo: () => { if (restoring.current) return; coalescing.current = false; if (current.current?.future.length) apply(redo(current.current), false); },
    retry: () => { failed.current = false; setStorageError(''); void drain(); },
    recover: async (data: WorkbenchData) => {
      if (!repository.current) throw new Error('DBに接続できません。元データの退避後に再試行してください');
      const recovered = await repository.current.recover(data);
      revision.current = recovered.revision;
      announce();
      current.current = startHistory(recovered.data);
      pending.current = null;
      failed.current = false;
      setHistory(current.current);
      setStorageError('');
      setError('');
      clearOwnJournal();
    },
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
