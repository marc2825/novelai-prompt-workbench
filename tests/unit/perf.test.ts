import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { record, startHistory } from '../../src/core/history';
import { WorkbenchRepository } from '../../src/data/repository';
import * as validation from '../../src/data/validation';
import { dataset, editOne } from './perf/dataset';

// Performance characterisation of the commit → save path at 100 / 500 / 2,000
// library entries. fake-indexeddb in Node is not Chrome, so absolute timings are
// only logged; assertions are structural (what a save reads and validates) plus
// loose budgets that catch order-of-magnitude regressions.
const elapsed = async (run: () => unknown | Promise<unknown>, rounds = 5) => {
  const start = performance.now();
  for (let index = 0; index < rounds; index++) await run();
  return (performance.now() - start) / rounds;
};

describe('commit → save performance', () => {
  for (const size of [100, 500, 2000]) it(`${size} records`, async () => {
    const data = dataset(size);
    const json = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    const repository = await WorkbenchRepository.open(`perf-${size}`, new IDBFactory());
    let revision = await repository.save(data, 0);
    let round = 0;
    // What the panel does per edit: validate once (commit), then save the validated object.
    const commitAndSave = async () => { const next = validation.validateData(editOne(data, ++round)); revision = await repository.save(next, revision); };
    await commitAndSave(); // warm up
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const validate = vi.spyOn(validation, 'validateData');
    const perEdit = await elapsed(commitAndSave);
    const validatedInSave = validate.mock.calls.length;
    const readsDuringSave = getAll.mock.calls.length;
    getAll.mockRestore(); validate.mockRestore();
    const validateOnly = await elapsed(() => validation.validateData(editOne(data, ++round)));
    const load = await elapsed(() => repository.load(), 3);
    let history = startHistory(data);
    for (let step = 0; step < 31; step++) history = record(history, validation.validateData(editOne(data, step)));
    console.log(`[perf] ${size} records: JSON ${(json / 1024).toFixed(0)} KiB, validate ${validateOnly.toFixed(1)} ms, commit+save ${perEdit.toFixed(1)} ms, load ${load.toFixed(1)} ms, undo history ≈ ${((history.past.length + 1) * json / 1048576).toFixed(1)} MiB (${history.past.length + 1} full copies)`);
    // A normal save checks only the revision (no full read of every store) …
    expect(readsDuringSave).toBe(0);
    // … and does not validate the already-validated object again (one call per commit only).
    expect(validatedInSave).toBe(5);
    expect(history.past.length).toBe(30);
    expect(perEdit).toBeLessThan(1000);
    expect(load).toBeLessThan(2000);
    repository.close();
  }, 60_000);

  it('a pre-import backup save still reads the full previous state', async () => {
    const repository = await WorkbenchRepository.open('perf-backup', new IDBFactory());
    const data = dataset(100);
    await repository.save(data, 0);
    await repository.save(validation.validateData(editOne(data, 1)), 1, true);
    expect(await repository.previousImport()).toMatchObject({ revision: 1, data: { libraryEntries: data.libraryEntries } });
    repository.close();
  });

  it('a save still detects a stale revision without reading every store', async () => {
    const factory = new IDBFactory();
    const first = await WorkbenchRepository.open('perf-conflict', factory);
    const second = await WorkbenchRepository.open('perf-conflict', factory);
    const data = dataset(100);
    await first.save(data, 0);
    await expect(second.save(validation.validateData(editOne(data, 1)), 0)).rejects.toThrow('別のパネル');
    expect((await first.load()).data).toEqual(data);
    first.close(); second.close();
  });
});
