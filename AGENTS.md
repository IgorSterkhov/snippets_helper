# Codex Working Prompt

This repository was previously developed with Claude Code. Keep the Claude
guidance files as source material and do not delete or replace them.

## Required Context

Before planning or editing, read the relevant existing guidance:

- `CLAUDE.md` — primary project rules, user workflow, release constraints,
  UTF-8/Rust safety notes, and desktop/mobile release policy.
- `FRONTEND_PATTERNS.md` — reusable UI patterns and frontend verification
  requirements.
- `desktop-rust/RELEASES.md` — required before changing
  `desktop-rust/src-tauri/`, `desktop-rust/src/`, or desktop release workflow
  files.
- `mobile/RELEASES.md` — required before mobile or mobile release changes.
- `.workflow/specs/` — approved design specs.
- `.workflow/plans/` — implementation plans.

## Workflow

1. Start by restating the requirement and design questions. Offer answer
   options when asking questions.
2. Do not implement until the user confirms the direction.
3. Put new requirement specs in `.workflow/specs`.
4. After writing a spec, present it in the browser visual companion for review
   when a local web review session is available. Use port `8765` when the user
   asks for a stable review URL.
5. Put implementation plans in `.workflow/plans`.
6. Preserve existing user and Claude changes. Do not revert unrelated files.
7. Keep commits short and one-line when commits are requested or required.

## Desktop App Notes

The main desktop app is in `desktop-rust/`:

- Frontend: vanilla JavaScript in `desktop-rust/src/`.
- Native commands: Rust/Tauri in `desktop-rust/src-tauri/src/commands/`.
- Browser mock and frontend smoke tests live in `desktop-rust/src/`.

For frontend changes, follow existing compact, utilitarian UI patterns. Run
`node --check` on changed JS files and `python3 dev-test.py` from
`desktop-rust/src` when practical.

For new or changed Tauri commands, treat the change as a native release
surface change. Follow `CLAUDE.md` and `desktop-rust/RELEASES.md`.
