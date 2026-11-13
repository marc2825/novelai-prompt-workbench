import { useEffect, useRef, useState } from 'react';
import { record, redo, replacePresent, startHistory, undo, type History } from '../core/history';
import type { WorkbenchData } from '../core/types';
import { MigrationError, WorkbenchRepository } from '../data/repository';
import { validateData } from '../data/validation';
import type { ImageWrite, PreparedImage } from '../data/images';

export function message(error: unknown): string { return error instanceof Error ? error.message : '不明なエラーです'; }

export function useWorkbench() {
  const [history, setHistory] = useState<History<WorkbenchData> | null>(null);
  const current = useRef<History<WorkbenchData> | null>(null);
  const repository = useRef<WorkbenchRepository | null>(null);
  const revision = useRef(0);
  const pending = useRef<{ data: WorkbenchData; backup: boolean } | null>(null);
  const running = useRef(false);
  const failed = useRef(false);
  const imageWrites = useRef(new Map<string, ImageWrite & { record: PreparedImage['record'] }>());
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [migrationRecovery, setMigrationRecovery] = useState<unknown>(null);
  const [loadNotice, setLoadNotice] = useState('');
  // Consecutive coalesced commits (shuffle steps) share one undo entry.
  const coalescing = useRef(false);

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
        for (const write of writes) if (next.data.images.some(image => image.id === write.id) && imageWrites.current.get(write.id) === write) imageWrites.current.delete(write.id);
      }
    } catch (cause) {
      failed.current = true;
      pending.current = current.current ? { data: current.current.present, backup: true } : null;
      setStorageError(message(cause));
    } finally { running.current = false; setSaving(false); }
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
    try {
      const next = validateData(typeof change === 'function' ? change(current.current.present) : change);
      const merge = !!options.coalesce && coalescing.current && current.current.past.length > 0;
      coalescing.current = !!options.coalesce;
      apply(merge ? replacePresent(current.current, next) : record(current.current, next), backup);
      setError('');
      return true;
    } catch (cause) { setError(message(cause)); return false; }
  };

  return {
    data: history?.present ?? null, saving, storageError, error, setError, commit, repository, migrationRecovery, loadNotice, setLoadNotice,
    /** Latest committed state, readable synchronously from async callbacks. */
    latest: () => current.current?.present ?? null,
    imageBlob: async (id: string, thumbnail = false) => {
      const pendingImage = imageWrites.current.get(id);
      const record = current.current?.present.images.find(image => image.id === id);
      if (!record) return undefined;
      if (pendingImage && pendingImage.record.hash === record.hash && pendingImage.record.width === record.width && pendingImage.record.height === record.height && pendingImage.record.byteLength === record.byteLength && pendingImage.record.thumbnailBytes === record.thumbnailBytes) return thumbnail ? pendingImage.thumbnail : pendingImage.original;
      return repository.current?.imageBlob(id, thumbnail, record);
    },
    attachImage: (prepared: PreparedImage, experimentId: string, variant: 'variantA' | 'variantB') => {
      const state = current.current?.present;
      if (!state?.experiments.some(item => item.id === experimentId)) throw new Error('比較セッションが削除されています');
      const existing = state.images.find(image => image.hash === prepared.record.hash);
      const id = existing?.id ?? prepared.id;
      const write = { id, original: prepared.original, thumbnail: prepared.thumbnail, record: prepared.record };
      imageWrites.current.set(id, write);
      const ok = commit(data => ({ ...data, images: existing ? data.images.map(image => image.id === id ? { ...image, width: prepared.record.width, height: prepared.record.height, byteLength: prepared.record.byteLength, thumbnailBytes: prepared.record.thumbnailBytes } : image) : [...data.images, prepared.record], experiments: data.experiments.map(item => item.id === experimentId ? { ...item, updatedAt: prepared.record.createdAt, [variant]: { ...item[variant], imageId: id } } : item) }));
      if (!ok) { imageWrites.current.delete(id); throw new Error('画像メタデータまたは比較の検証に失敗しました'); }
      return existing ? '同一ハッシュの画像を再利用しました。' : '画像を取り込みました。';
    },
    purgeImages: async () => {
      if (running.current || pending.current || failed.current) throw new Error('保存完了後に実行してください');
      const states = current.current ? [...current.current.past, current.current.present, ...current.current.future] : [];
      await repository.current?.purgeUnreferenced(states.flatMap(state => state.images.map(image => image.id)));
    },
    canUndo: !!history?.past.length, canRedo: !!history?.future.length,
    undo: () => { coalescing.current = false; if (current.current?.past.length) apply(undo(current.current), false); },
    redo: () => { coalescing.current = false; if (current.current?.future.length) apply(redo(current.current), false); },
    retry: () => { failed.current = false; setStorageError(''); void drain(); },
    recover: async (data: WorkbenchData) => {
      if (!repository.current) throw new Error('DBに接続できません。元データの退避後に再試行してください');
      const recovered = await repository.current.recover(data);
      revision.current = recovered.revision;
      current.current = startHistory(recovered.data);
      pending.current = null;
      failed.current = false;
      setHistory(current.current);
      setStorageError('');
      setError('');
    },
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
