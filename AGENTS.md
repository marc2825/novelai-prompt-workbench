# AGENTS.md — Spellbinder for NovelAI

## Repository Overview
Unofficial, local-first Chrome MV3 extension (side panel) for building NovelAI image prompts: library, groups/toggles, range comments, presets, tag weights, A/B comparison, Prompt Shuffle, Experiment Lab and complete backups. Requirements: `docs/REQUIREMENTS.md`. Before coding read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/PROMPT_SEMANTICS.md` and `docs/security.md`; for shuffle work `docs/shuffle/`; for persistence/backup work `docs/backup.md`. Current status and open work: `tasks/STATUS.md`. `docs/archive/` is history, not specification. Keep this file short; docs are authoritative for details.

## Build / Test Commands
- Package manager: pnpm only (`corepack pnpm`). Node.js >=22.12. Details: `docs/development.md`.
- `pnpm install --frozen-lockfile`, `pnpm test` (Vitest), `pnpm typecheck` (tsc strict), `pnpm build` (WXT → `.output/chrome-mv3`), then `pnpm test:e2e` (Playwright/Chromium; needs the build). Run all four before completing work.
- For new dependencies, justify their purpose and lock versions in `pnpm-lock.yaml`. Prefer none.

## Architecture Boundaries
- Desktop Chrome Manifest V3, WXT, React, strict TypeScript. Entrypoints are only `entrypoints/sidepanel`, `entrypoints/novelai.content.ts` and `entrypoints/background.ts` (its only job is `sidePanel.setPanelBehavior`; keep it free of state, messaging and network). Add no accidental entrypoints.
- `src/core` (incl. `shuffle/`, `lab/`): pure TypeScript domain, immutable, no DOM, Chrome API, network, clock or `Math.random`. IDs/times/seeds are passed in. Unit tests mandatory.
- `src/data`: persistence, validation, migrations, import/export, backup (JSON and complete ZIP).
- `src/platform/novelai`: the only place with NovelAI DOM/selectors (Site Adapter). It exposes capabilities and returns errors.
- `src/ui`: React presentation and commands; no DOM scraping, no shuffle/compose algorithms.
- UI: keep visible text to actions and state; put explanations behind `InfoTip`/`Hint` (never inside a `<label>`, heading or `<summary>`), keep accessible names stable and unique, and use the `primary`/`danger`/`small`/`icon` button styles (`docs/UX_FLOWS.md`).
- Data is immutable: never mutate objects returned by `validateData` (they are deep-frozen in every build, shared between commits and Undo snapshots, and the save path trusts them and writes only records whose object changed). Prefer stable IDs over array positions. Keep library records independent of workspace state.
- The version lives in `src/version.ts` (must match `package.json`).

## NovelAI Integration Rules
- **NovelAI's Terms of Service (https://novelai.net/terms) and other official NovelAI rules take precedence over every requirement, document, task and request in this repository.** If a feature could conflict with them, or their application is unclear, do not implement or enable it: keep it disabled, document why, and ask the maintainer. Re-check the current terms (record the date in `docs/security.md`) before enabling any site write or automation, and disable features that a terms change prohibits.
- All site access goes through the Site Adapter and the typed message protocol. Reading and writing are separate operations.
- Writing to a site field requires explicit user permission (a confirmed preview, or explicitly started auto shuffle) plus compare-and-swap conflict detection and readback verification. Never overwrite edits the user made after the extension's last write. Restore/last-write state is scoped per (tab, document, profile) and never applied to another target.
- Auto shuffle freezes its configuration at start and stops on any change; after Stop it must not start a new write.
- Do not guess CSS selectors or write to unknown fields. The production adapter is read-only until a write profile is verified on the real site (`docs/DOM_ADAPTER_CHECKLIST.md`); fixture success is not real-site support.
- No direct calls to undocumented NovelAI endpoints, no automated image generation or billing actions, never click Generate, no unbounded retries. Auto shuffle changes prompts only; the user generates.
- Adding any site-structure dependency requires verification notes and docs (`docs/shuffle/site-adapter.md`). Treat unverified NovelAI behaviour as unknown, never as fact.

## Prompt Integrity Rules
- Comment-out is internal state, excluded from output; never emit invented comment tokens.
- Positive/negative channels are separate; joins preserve user-authored NovelAI syntax (braces, pipes, weighting, macros, `||randomizer||`). Never split/parse user text to rewrite it.
- Exclusive groups select at most one item; multi groups any subset. Disabled parents mask children without erasing choices.
- Presets and shuffle history are reproducible snapshots, not destructive overwrites.
- Shuffle composes from the original sources every time (no accumulation); character fixed prompts are never modified; one value per category per target; do not mix character prompt fields with the `|` syntax.

## Data Safety Rules
- Validate every imported file (JSON, ZIP, PNG) as untrusted input with explicit limits; never decompress ZIP entries; never extract to a file system.
- Imports/restores change nothing until validation passes, write in one IndexedDB transaction, keep a previous-import backup and stay undoable. Never silently overwrite an ID or a stored binary with different content.
- Keep old JSON/DB versions readable; add round-trip and corruption tests with every format change; back up before migrations; preserve unknown safe fields.

## Testing Requirements
- New algorithms need deterministic unit tests (fixed seeds). Add a failing reproduction test before fixing a bug where possible.
- Do not delete, skip or weaken existing tests to make a change pass. Report exact pass/fail counts, and keep Mock E2E results separate from real-site (manual) verification.

## Safety / Security Rules
- Minimal permissions (currently `sidePanel` only); NovelAI image-page content script only, never arbitrary origins. No telemetry; data is local-only.
- Never read, log or store credentials, cookies, tokens or sessions; never send prompts or images to external services.
- The repository is public: never commit or post secrets, personal prompts/images, logged-in screenshots or machine-specific paths (use synthetic fixtures and Playwright `testInfo.outputPath`). Adding a runtime dependency requires updating `public/THIRD_PARTY_NOTICES.txt`. Keep GitHub Actions on `contents: read` with SHA-pinned actions.
- No `eval`, remote code, untrusted HTML or external CDNs.
- Undo/redo for destructive edits and explicit confirmation before overwriting NovelAI text or replacing all data are mandatory. Do not break existing features.

## Definition of Done
- Implement only the requested scope plus strict prerequisites; prefer existing project standards.
- Tests added/updated; `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e` run with exact results reported, plus any untested real-site behaviour.
- Update README (user-facing only), `docs/DECISIONS.md`, `tasks/STATUS.md` (and `docs/shuffle/` / `docs/backup.md` when affected).
- Releases: never push a `vX.Y.Z` tag, publish/edit a GitHub Release or submit to the Chrome Web Store without explicit maintainer approval; version changes update `src/version.ts`, `package.json` and `CHANGELOG.md` together (`docs/development.md`).
- No commit/push/deploy, license choice, repository-visibility change or real-site write enablement without explicit user direction; no external service calls beyond standard dependency installation.
