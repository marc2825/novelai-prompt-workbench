# CLAUDE.md

Read and follow `AGENTS.md` first; it is the project's rulebook and is not repeated here.

- Skills: shuffle / Scene Template / Role Assignment / Site Adapter work → `novelai-prompt-shuffle`; persistence, migrations, JSON/ZIP import-export, backup/restore → `workbench-data-safety` (`.claude/skills/`).
- Before finishing: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:e2e` (E2E reads the build).
- Chromium missing shared libraries (e.g. `libnspr4.so`) without root: see `docs/development.md` (extract with `apt-get download` + `dpkg -x`, set `LD_LIBRARY_PATH`). Put such files in your scratch directory, not the repository.
- The UI and docs are Japanese. Keep accessible labels unique per page; E2E tests select by exact role and name.
- Real-site NovelAI writes are intentionally disabled. Do not report fixture results as real-site verification.
