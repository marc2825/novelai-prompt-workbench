import type { WorkbenchData } from '../../src/core/types';
import { createDemo } from '../../src/data/demo';

export const timestamp = '2026-11-03T00:00:00.000Z';
export function fixture(): WorkbenchData {
  let counter = 0;
  return createDemo(() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, timestamp);
}
