import { shuffled, type Rng } from './random';

/**
 * Role assignment = injective map role index -> character ID, where each role may
 * only take characters from its own eligible list. Role IDs and character IDs are
 * different namespaces and are never compared with each other.
 */
export type Eligibility = readonly (readonly string[])[];

/** Kuhn's augmenting-path matching. True when every role can get a distinct character. */
export function hasCompleteMatching(eligibility: Eligibility, taken: ReadonlySet<string> = new Set()): boolean {
  const owner = new Map<string, number>();
  const tryRole = (role: number, visited: Set<string>): boolean => {
    for (const character of eligibility[role]!) {
      if (taken.has(character) || visited.has(character)) continue;
      visited.add(character);
      const current = owner.get(character);
      if (current === undefined || tryRole(current, visited)) { owner.set(character, role); return true; }
    }
    return false;
  };
  for (let role = 0; role < eligibility.length; role++) if (!tryRole(role, new Set())) return false;
  return true;
}

/**
 * Enumerate every valid assignment in a stable order, or return null as soon as
 * more than `cap` exist. Never materialises a large permutation space.
 */
export function enumerateAssignments(eligibility: Eligibility, cap: number): string[][] | null {
  const results: string[][] = [];
  const current: string[] = [];
  const used = new Set<string>();
  let overflow = false;
  const visit = (role: number) => {
    if (overflow) return;
    if (role === eligibility.length) {
      results.push([...current]);
      if (results.length > cap) overflow = true;
      return;
    }
    for (const character of eligibility[role]!) {
      if (used.has(character)) continue;
      used.add(character); current.push(character);
      visit(role + 1);
      current.pop(); used.delete(character);
      if (overflow) return;
    }
  };
  if (!hasCompleteMatching(eligibility)) return [];
  visit(0);
  return overflow ? null : results;
}

/** Random valid assignment by staged sampling with a feasibility check per step. */
export function sampleAssignment(eligibility: Eligibility, rng: Rng): string[] | null {
  if (!hasCompleteMatching(eligibility)) return null;
  const result: string[] = new Array<string>(eligibility.length);
  const taken = new Set<string>();
  for (const role of shuffled([...eligibility.keys()], rng)) {
    const rest = eligibility.filter((_, index) => index !== role && result[index] === undefined);
    let placed = false;
    for (const character of shuffled(eligibility[role]!.filter(id => !taken.has(id)), rng)) {
      taken.add(character);
      if (hasCompleteMatching(rest, taken)) { result[role] = character; placed = true; break; }
      taken.delete(character);
    }
    if (!placed) return null; // Unreachable when the initial matching exists.
  }
  return result;
}

export function assignmentKey(roleIds: readonly string[], characterIds: readonly string[]): string {
  return roleIds.map((roleId, index) => `${roleId}=${characterIds[index]}`).join(',');
}
