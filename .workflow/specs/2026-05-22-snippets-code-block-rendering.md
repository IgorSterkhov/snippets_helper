# Snippets Code Block Rendering Spec

## Goal

Improve rendered Markdown code blocks in the Snippets module so indented fence
markers render correctly and every fenced code block has a compact header.

## Requirements

- Before Markdown rendering, normalize only fence-marker lines:
  - `   ```bash` renders as a fenced `bash` block.
  - `   ``` ` renders as a fenced block without a language.
  - Code content inside the fence keeps its original indentation.
- Show a compact header strip for every rendered fenced code block.
  - If the fence has a language, show that language in the header.
  - If the fence has no language, show `plain`.
  - Move the existing copy button into the header on the right.
- Copying a block copies only the code text, not the header label.
- Language coloring should cover common languages:
  - Shell: `bash`, `sh`, `zsh`, `shell`
  - SQL: `sql`, `postgres`, `postgresql`, `mysql`, `sqlite`
  - Web: `html`, `xml`, `css`, `scss`
  - JS/TS/data: `js`, `javascript`, `ts`, `typescript`, `json`
  - Backend/common: `python`, `py`, `rust`, `rs`, `go`, `java`, `kotlin`,
    `swift`, `php`, `ruby`, `rb`, `c`, `cpp`, `cs`
  - Config/docs: `yaml`, `yml`, `toml`, `ini`, `dockerfile`, `markdown`, `md`
  - Unknown languages use the typed label and a neutral accent.
- Apply the behavior consistently to snippet Code, Description, and Obsidian
  Note rendered Markdown views.

## Out of Scope

- Syntax highlighting.
- Changing Markdown editor insertion behavior.
- Backend/Rust changes or new Tauri commands.

## Verification

- Add a browser smoke test that opens a snippet containing indented fenced
  blocks and verifies:
  - `bash`, `sql`, and `plain` headers are visible.
  - The indented fence rendered as `<pre><code>`, not plain paragraph text.
  - Copying a block returns only code content.
- Run `node --check` on changed JS files.
- Run `python3 dev-test.py` from `desktop-rust/src`.
