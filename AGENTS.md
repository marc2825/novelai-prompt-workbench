# AGENTS.md — NovelAI Prompt Workbench

## Mission / priority
Implement the user-facing requirements in `docs/REQUIREMENTS.md` incrementally. Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/PROMPT_SEMANTICS.md`, and relevant phase prompt before coding. Keep this file short; docs are authoritative for details.

## Commands
- Package manager: pnpm only. Node.js >=22. Use `corepack pnpm` if needed.
- `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm build` before completing each phase.
- For new dependencies, justify their purpose and lock versions in `pnpm-lock.yaml`.
- Do not claim browser/site integration verified until actually exercised manually.

## Boundaries / security
- Desktop Chrome Manifest V3, WXT, React, TypeScript, strict TypeScript.
- No direct calls to undocumented NovelAI endpoints, no scraping of accounts, no credential/session/API-token collection, and no automated image-generation loops. The user manually submits every generation.
- Minimal site access: NovelAI image-page DOM only, not arbitrary origins. Avoid network telemetry. Data local-only in v1.
- NovelAI adapter must be replaceable and return capabilities/errors; on failure provide non-destructive copy fallback. Do not guess CSS selectors or write to unknown fields.
- No evaluation of user prompt strings, no `eval`, remote executable code, untrusted HTML, external CDNs, or uploading user images.
- Import JSON as untrusted input; validate schema, enforce limits, back up before migrations, and preserve unknown safe fields when possible.

## Architecture
- `src/core`: pure TypeScript domain, immutable compiler, no browser/DOM APIs. Unit tests mandatory.
- `src/data`: persistence, migrations, import/export, backup.
- `src/platform/novelai`: DOM adapters; keep UI selectors here only.
- `src/ui`: React presentation and commands; no direct DOM scraping.
- `entrypoints`: WXT manifest-driven entrypoints. Add no accidental extra entrypoints.
- Prefer stable IDs over array positions. Keep library records independent of workspace state.

## Prompt semantics
- Comment-out is internal state, excluded from output; never emit invented comment tokens to NovelAI.
- Support positive/negative prompt channels separately; default joins must preserve user-authored NovelAI syntax (braces, pipes, weighting, macros).
- Exclusive groups select at most one item; multi groups select any subset. Disabled parent always masks children without erasing choices.
- Presets are reproducible snapshots, not destructive overwrites of library entries.
- Undo/redo for destructive edits, import validation, and explicit confirmation before overwriting NovelAI text are mandatory.

## Definition of done for any phase
- Implement only that phase plus strict prerequisites; avoid speculative features.
- Add/update tests including edge cases and corruption recovery.
- Run test/typecheck/build and report exact results and any untested real-site behavior.
- Update README, `docs/DECISIONS.md`, and `tasks/STATUS.md` with decisions and limitations.
- No commit/push/deploy without explicit user direction; no external service calls beyond standard dependency installation.
