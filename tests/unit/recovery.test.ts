import { describe, expect, it } from 'vitest';
import { recoveryJson } from '../../src/data/recovery';
import { fixture } from './helpers';

describe('corrupt storage recovery serialization', () => {
  it('preserves normal data and shared non-cyclic values without deleting any fields', () => {
    const data = fixture(); const shared = { raw: '{{髪}} | !macro:名!', enabled: false };
    const value = { data, first: shared, second: shared };
    expect(recoveryJson(value)).toBe(JSON.stringify(value, null, 2));
  });
  it('marks cycles/non-JSON numbers/deep structures without mutating the original corrupt object', () => {
    const cyclic: Record<string, unknown> = { bigint: 42n, infinite: Infinity }; cyclic.self = cyclic;
    const deep: Record<string, unknown> = {}; let cursor = deep;
    for (let index = 0; index < 80; index++) { const next = {}; cursor.next = next; cursor = next; }
    const result = recoveryJson({ cyclic, deep });
    expect(() => JSON.parse(result)).not.toThrow();
    expect(result).toContain('循環参照'); expect(result).toContain('BigInt:42'); expect(result).toContain('深さ上限');
    expect(cyclic.self).toBe(cyclic); expect(cyclic.bigint).toBe(42n);
  });
});
