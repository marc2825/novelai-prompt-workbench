# AGENTS.md — NovelAI Prompt Workbench

## Repository Overview
Unofficial, local-first Chrome MV3 extension (side panel) for building NovelAI image prompts: library, groups/toggles, range comments, presets, A/B comparison, and Prompt Shuffle. Implement the user-facing requirements in `docs/REQUIREMENTS.md` incrementally. Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/PROMPT_SEMANTICS.md`, and the relevant phase prompt (`codex/`) before coding; for shuffle work read `docs/shuffle/`. Keep this file short; docs are authoritative for details.

## Build / Test Commands
- Package manager: pnpm only (`corepack pnpm`). Node.js >=22.12.
- `pnpm install --frozen-lockfile`, `pnpm test` (Vitest), `pnpm typecheck` (tsc strict), `pnpm build` (WXT → `.output/chrome-mv3`), then `pnpm test:e2e` (Playwright/Chromium; needs the build). Run all four before completing a phase.
- For new dependencies, justify their purpose and lock versions in `pnpm-lock.yaml`.

## Architecture Boundaries
- Desktop Chrome Manifest V3, WXT, React, strict TypeScript. Entrypoints are only `entrypoints/sidepanel` and `entrypoints/novelai.content.ts`; add no accidental entrypoints.
- `src/core` (incl. `src/core/shuffle`): pure TypeScript domain, immutable, no DOM, Chrome API, network, clock or `Math.random`. IDs/times/seeds are passed in. Unit tests mandatory.
- `src/data`: persistence, validation, migrations, import/export, backup.
- `src/platform/novelai`: the only place with NovelAI DOM/selectors (Site Adapter). It exposes capabilities and returns errors.
- `src/ui`: React presentation and commands; no DOM scraping, no shuffle/compose algorithms.
- Prefer stable IDs over array positions. Keep library records independent of workspace state.

## NovelAI Integration Rules
- All site access goes through the Site Adapter and the typed message protocol. Reading and writing are separate operations.
- Writing to a site field requires explicit user permission (a confirmed preview, or explicitly started auto shuffle) plus compare-and-swap conflict detection and readback verification. Never overwrite edits the user made after the extension's last write.
- Do not guess CSS selectors or write to unknown fields. The production adapter is read-only until a write profile is verified on the real site (`docs/DOM_ADAPTER_CHECKLIST.md`); fixture success is not real-site support.
- No direct calls to undocumented NovelAI endpoints, no automated image generation or billing actions, never click Generate, no unbounded retries. Auto shuffle changes prompts only; the user generates.
- Adding any site-structure dependency requires verification notes and docs (`docs/shuffle/site-adapter.md`). Treat unverified NovelAI behaviour as unknown, never as fact.

## Prompt Integrity Rules
- Comment-out is internal state, excluded from output; never emit invented comment tokens.
- Positive/negative channels are separate; joins preserve user-authored NovelAI syntax (braces, pipes, weighting, macros, `||randomizer||`). Never split/parse user text to rewrite it.
- Exclusive groups select at most one item; multi groups any subset. Disabled parents mask children without erasing choices.
- Presets and shuffle history are reproducible snapshots, not destructive overwrites.
- Shuffle composes from the original sources every time (no accumulation); character fixed prompts are never modified; one value per category per target; do not mix character prompt fields with the `|` syntax.

## Testing Requirements
- New shuffle/sampling algorithms need deterministic unit tests (fixed seeds). Add edge cases and corruption-recovery tests with every data change.
- Do not delete or skip existing tests to make a change pass. Report exact pass/fail counts, and keep Mock E2E results separate from real-site (manual) verification.

## Safety / Security Rules
- Minimal permissions (currently `sidePanel` only); NovelAI image-page content script only, never arbitrary origins. No telemetry; data is local-only.
- Never read, log or store credentials, cookies, tokens or sessions; never send prompts or images to external services.
- No `eval`, remote code, untrusted HTML or external CDNs. Validate imported JSON as untrusted input, enforce limits, back up before migrations, preserve unknown safe fields.
- Undo/redo for destructive edits, import validation, and explicit confirmation before overwriting NovelAI text are mandatory. Do not break existing preset/library/toggle features.

## Definition of Done
- Implement only the requested phase plus strict prerequisites; prefer existing project standards and avoid unneeded dependencies.
- Tests added/updated; `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` run with exact results reported, plus any untested real-site behaviour.
- Update README, `docs/DECISIONS.md`, `tasks/STATUS.md` (and `docs/shuffle/` for shuffle changes) with decisions and limitations.
- No commit/push/deploy without explicit user direction; no external service calls beyond standard dependency installation.
