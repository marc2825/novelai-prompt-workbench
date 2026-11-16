import { MAX_AXIS_VALUES } from './types';

export function csvValues(input: string): string[] {
  const result: string[] = []; let value = ''; let quoted = false; let closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else value += c; }
    else if (c === ',' || c === '\n' || c === '\r') { result.push(value); value = ''; closed = false; if (c === '\r' && input[i + 1] === '\n') i++; }
    else if (c === '"' && !value.trim() && !closed) { value = ''; quoted = true; }
    else if (closed && c.trim()) throw new Error('CSV: closing quote must be followed by a delimiter');
    else if (c === '"') throw new Error('CSV: unexpected quote');
    else if (!closed) value += c;
  }
  if (quoted) throw new Error('CSV: unclosed quote');
  result.push(value);
  return result;
}
export function distinct(values: string[]): string[] {
  if (!values.length || values.length > MAX_AXIS_VALUES || values.some(v => !v.trim())) throw new Error('Values: 1–64 non-empty candidates required');
  if (new Set(values).size !== values.length) throw new Error('Duplicate values / 値が重複しています');
  return values;
}
export function textValues(input: string, format: 'lines' | 'csv'): string[] {
  return distinct((format === 'csv' ? csvValues(input) : input.replace(/\r\n/g, '\n').split('\n')).map(v => v.trim()));
}
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const RANGE = new RegExp(`^(${NUMBER})\\s*-\\s*(${NUMBER})\\s*(?:\\(\\s*(${NUMBER})\\s*\\)|\\[\\s*(\\d+)\\s*\\])?$`);
export function numericValues(input: string): string[] {
  const values: string[] = [];
  const add = (n: number) => { if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error('Number out of bounds'); values.push(String(Number(n.toFixed(8)))); if (values.length > MAX_AXIS_VALUES) throw new Error('Axis exceeds 64 values'); };
  for (const part of input.split(/[\n,]/).map(v => v.trim())) {
    if (!part) throw new Error('Empty numeric value');
    const range = RANGE.exec(part);
    if (!range) { if (!new RegExp(`^${NUMBER}$`).test(part)) throw new Error('Invalid number / range'); add(Number(part)); continue; }
    const a = Number(range[1]); const b = Number(range[2]);
    if (range[4]) {
      const count = Number(range[4]); if (count < 2 || count > MAX_AXIS_VALUES || a === b) throw new Error('Range count must be 2–64 with different endpoints');
      for (let i = 0; i < count; i++) add(a + (b - a) * i / (count - 1));
    } else {
      const step = range[3] ? Number(range[3]) : a <= b ? 1 : -1;
      if (!step || (b - a) * step < 0) throw new Error('Range step has wrong direction or is zero');
      const count = Math.floor((b - a) / step + 1e-8) + 1;
      if (count > MAX_AXIS_VALUES) throw new Error('Axis exceeds 64 values');
      for (let i = 0; i < count; i++) add(a + i * step);
    }
  }
  return distinct(values);
}
export function seedList(input: string): string[] {
  return distinct(input.split(/[,\s]+/).filter(Boolean).map(value => {
    if (!/^\d{1,100}$/.test(value)) throw new Error('Seed must be a digit string (max 100 digits)');
    return BigInt(value).toString();
  }));
}
export function consecutiveSeeds(start: string, count: number): string[] {
  seedList(start); if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Seed count: 1–64');
  return seedList(Array.from({ length: count }, (_, i) => (BigInt(start) + BigInt(i)).toString()).join(','));
}
