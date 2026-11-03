// Recovery files are diagnostics, never accepted as normal import documents.
// Preserve ordinary JSON exactly while marking values a corrupt IDB may contain.
export function recoveryJson(value: unknown): string {
  const ancestors: object[] = [];
  return JSON.stringify(value, function (this: unknown, _key, item: unknown) {
    if (typeof item === 'bigint') return `[BigInt:${item.toString()}]`;
    if (typeof item === 'number' && !Number.isFinite(item)) return `[Number:${String(item)}]`;
    if (item && typeof item === 'object') {
      while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(item)) return '[循環参照:復旧診断用]';
      if (ancestors.length >= 64) return '[深さ上限:復旧診断用]';
      ancestors.push(item);
    }
    return item;
  }, 2) ?? 'null';
}
