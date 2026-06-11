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
2. Do not implement until the user confirms the product/UX direction after a
   short preliminary discussion. This discussion is still required even when
   the user has said they do not want to approve formal spec/plan documents.
3. Put new requirement specs in `.workflow/specs`.
4. Do not stop for user approval of the written spec or implementation plan
   unless the user explicitly asks to review them. Instead, run an additional
   reviewer agent for the spec/plan and apply blocking or important feedback
   before implementation. This skips only final document approval, not the
   preliminary product/design discussion in step 2.
5. After writing a spec, present it in the browser visual companion for review
   when the user explicitly asks for visual review or when visual design choices
   are the active deliverable. Use port `8765` when the user asks for a stable
   review URL.
6. Put implementation plans in `.workflow/plans`.
7. Preserve existing user and Claude changes. Do not revert unrelated files.
8. Keep commits short and one-line when commits are requested or required.
9. For every desktop release with user-facing changes, update Help and release
   history before tagging. Treat `desktop-rust/src/tabs/help.js`,
   `desktop-rust/src/release-history.md`, and `desktop-rust/CHANGELOG.md` as a
   mandatory release gate, not an optional cleanup.
10. Before tagging a desktop release, choose the semver bump from
    `desktop-rust/RELEASES.md`: patch for fixes/small polish, minor for new
    modules/workflows/provider integrations/API or Tauri command surface, and
    major for incompatible DB/API/sync or removed-workflow changes.

## Dirty Worktree Cleanup

When the worktree has unrelated dirty files, classify them before deciding
whether to keep, commit, or remove them.

- Preserve anything that looks semantic, task-related, or user-authored. Do not
  revert those changes without explicit user direction.
- Automatically remove only mechanically proven noise, for example a mass
  formatter-only Rust diff. Prove it first by comparing against formatted
  `HEAD` copies in `/tmp` or an equivalent non-mutating check, and inspect any
  files that differ from pure formatting.
- Before removing mechanical noise, save a patch under `/tmp`, then restore
  only the confirmed noisy paths with a path-scoped command such as
  `git restore -- <paths>`. Never use broad destructive cleanup such as
  `git reset --hard`.
- Useful untracked workflow artifacts, such as missed checkpoint files, should
  be committed separately from product fixes. Throwaway generated/cache files
  may be deleted when they are clearly not source artifacts.
- If classification is ambiguous, stop cleanup and ask the user instead of
  guessing.

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

## Current Scope

Do not modify the legacy Python application unless the user explicitly asks for
it. Default product work is in `desktop-rust/`, including the Tauri/Rust backend
and its desktop frontend.

This restriction applies to the legacy Python desktop application only. The
Python server/API code in `api/`, `sync/`, and shared sync modules may be
modified when the active task requires a server-side fix.

## Tooling Notes

If Codex subagents or MCP-backed app tools hang on this repository, continue
with direct shell commands and local file inspection. Do not make subagent
review a hard dependency while `codex_apps` is unstable.
