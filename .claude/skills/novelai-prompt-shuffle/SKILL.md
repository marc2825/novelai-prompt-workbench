---
name: novelai-prompt-shuffle
description: Use when implementing or changing NovelAI prompt shuffling in this repository — the shuffle engine, Scene Templates (role templates / pose sets), Role Assignment, sampling (Shuffle Bag, weighted, seeded), prompt composition, generation-aware auto shuffle, shuffle persistence, or the NovelAI Site Adapter it writes through.
---

# NovelAI Prompt Shuffle

Read `AGENTS.md`, then `docs/shuffle/architecture.md` and `docs/shuffle/data-model.md`. For site work also read `docs/shuffle/site-adapter.md` and `docs/DOM_ADAPTER_CHECKLIST.md`.

## Workflow

1. **Check what exists.** Types in `src/core/shuffle/types.ts`, validation in `src/data/shuffle.ts`, protocol in `src/platform/novelai/protocol.ts`, and the site capability table in `docs/shuffle/site-adapter.md`. Do not assume a NovelAI feature works because a fixture supports it.
2. **Change Domain / Engine first** (`src/core/shuffle/`). Keep it pure: seeds, IDs and times come in as values. Never enumerate the full product of axes; sample in stages and cap enumeration.
3. **Test determinism and constraints.** Add Vitest cases under `tests/unit/shuffle/` with fixed seeds: same seed → same sequence, bag cycles without duplicates, invalid weights, 0/1 candidates, 1/2/3+ characters, fixed prompts unchanged, no tag growth on repeated composition.
4. **Update the Site Adapter only as far as needed** (`src/platform/novelai/`). Keep selectors there. Expose capabilities, fail safely (`UNSUPPORTED`/`CONFLICT`/`BUSY`), keep writes on the ticket + CAS + readback path, and keep the production adapter read-only unless a real-site profile has been verified and documented.
5. **Integrate into the UI** (`src/ui/Shuffle.tsx`, `src/ui/shuffle/`). Use existing components/styles, keep it compact, and keep algorithms out of React. Schema changes need `SHUFFLE_SCHEMA_VERSION`, a migration, and validation.
6. **Verify conflict, restore and stop paths.** User edits after the last write must never be overwritten silently. Restore must return the pre-apply text. Auto shuffle must stop on unsupported pages, navigation, a missing status element, or a lease held by another panel, and must never write while generating.
7. **Run everything:** `corepack pnpm test`, `typecheck`, `build`, `test:e2e` (`tests/e2e/shuffle.spec.ts` + `extension.spec.ts`). Report exact counts.
8. **Update docs:** `docs/shuffle/*`, `docs/DECISIONS.md`, `tasks/STATUS.md`, README.

## Never

- Put DOM, `chrome.*` or site knowledge into `src/core/shuffle`.
- Add automatic operations with unlimited retries, click Generate, or call private/undocumented NovelAI APIs.
- Overwrite user input unconditionally, or rewrite/delete user-authored tags (only warn).
- Delete or weaken existing specs/tests to make a change pass.
- Report a check as PASS that was not actually run, or report Mock E2E as real-site verification.
