---
name: workbench-data-safety
description: Use when changing how NovelAI Prompt Workbench stores, validates, migrates, imports, exports, backs up or restores data — IndexedDB repository/schema, validateData, JSON backup, complete backup ZIP (manifest, images), Lab export, image binaries, undo/save queue (useWorkbench), or anything that could lose or overwrite user data.
---

# Workbench data safety

Read `AGENTS.md` (Data Safety Rules), `docs/DATA_MODEL.md`, `docs/backup.md` and `docs/security.md` first.

## Where things live

- `src/data/validation.ts` — `validateData` (full schema/size/ID checks, returns a validated, structured-cloned object registered in a WeakSet; frozen in dev/E2E). `parseBackup` for JSON v1/v2/v3.
- `src/data/repository.ts` — IndexedDB (DB v3). `save()` = one transaction over all stores, revision check (conflict → `StorageConflictError`), optional `previousImport` backup, image binaries verified before the transaction opens. Migrations v1/v2→v3 back up first and are atomic.
- `src/data/zip.ts` — stored-only ZIP writer/reader (no decompression, strict names/headers).
- `src/data/full-backup.ts` — complete backup: export, `inspectFullBackup` (verify everything, write nothing), `planFullRestore` (merge/replace, binary ID collision check).
- `src/ui/useWorkbench.ts` — commit/undo/save queue; `restoreFull` (direct atomic save, edits blocked meanwhile); cross-panel `BroadcastChannel` notice.

## Workflow

1. **Reproduce first.** Add a failing Vitest case (fake-indexeddb) for the bug or the new format rule.
2. **Never weaken validation** to make data fit. New fields: validate, keep unknown safe fields, keep old versions readable.
3. **Format changes** need: a version bump (DB `SCHEMA_VERSION`, JSON `schemaVersion`, or full-backup `manifestVersion`), a migration that backs up first, and round-trip + old-version + corruption tests.
4. **Writes are atomic**: all related records and binaries in one transaction; on failure the DB and the screen keep the previous data. Test quota failure with a `vi.spyOn(IDBObjectStore.prototype, 'put')` that throws `QuotaExceededError` mid-transaction.
5. **Never overwrite silently**: ID/hash collisions are errors; a stored binary with a different hash under the same ID is never replaced (Undo history and `previousImport` may reference it).
6. **Untrusted input**: size/count/depth limits, `__proto__` keys, path allowlists, SHA-256/CRC verification, PNG structure. Read large files entry by entry (Blob.slice), not all at once.
7. **Do not mutate validated data** (the save path skips re-validation for it). Build new objects.
8. Run `test`, `typecheck`, `build`, `test:e2e` (`backup.spec.ts`, `workbench.spec.ts`, `comparisons.spec.ts`). Update `docs/backup.md` / `DATA_MODEL.md` / `DECISIONS.md` / `tasks/STATUS.md`.

## Never

- Auto-initialise or "repair" a corrupt DB by deleting data; offer a recovery dump instead.
- Import partially, or write before every check has passed.
- Report a check as passed that was not run.
