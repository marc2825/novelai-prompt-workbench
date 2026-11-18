# CLAUDE.md

Read and follow `AGENTS.md` first; it is the project's rulebook and is not repeated here.

- Feature architecture: `docs/ARCHITECTURE.md`; Prompt Shuffle: `docs/shuffle/architecture.md` (+ data-model, site-adapter, test-plan, limitations).
- For shuffle / Scene Template / Role Assignment / Site Adapter work, use the `novelai-prompt-shuffle` skill (`.claude/skills/novelai-prompt-shuffle/SKILL.md`).
- Before finishing: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:e2e`.
- Repository notes:
  - The E2E suite reads the built extension, so run `pnpm build` before `pnpm test:e2e`.
  - If Chromium fails with missing shared libraries (e.g. `libnspr4.so`) and there is no root access, extract `libnspr4 libnss3 libasound2t64` with `apt-get download` + `dpkg -x` into a scratch directory and set `LD_LIBRARY_PATH` to its `usr/lib/x86_64-linux-gnu`.
  - The UI and docs are Japanese. Keep accessible labels unique per page; E2E tests select by exact role and name.
  - Real-site NovelAI writes are intentionally disabled. Do not report fixture results as real-site verification.
