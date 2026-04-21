# Repo Search — Groups & Multi-Add

Design spec. Generated from brainstorming session on 2026-04-21.

## Context

The Repo Search tab currently renders all saved repositories as a flat
chip-bar. Users now maintain 7+ repos covering unrelated categories
(databases, Airflow DAGs, infra configs, misc). Two pain points emerged:

1. No way to narrow the set of repos for a search to "all databases" or
   "all Airflow" — every chip has to be toggled individually.
2. Adding repos one-by-one is slow when a batch of new projects lands on
   disk. The existing Add-Repo modal accepts a single folder per submit.

This spec adds **named groups** (with icon + color) for organising repos,
plus **multi-folder selection** on the Add button. Scope is deliberately
small — it does not touch search execution, indexing, or sync.

## Goals

- Let the user partition repos into named groups, then filter / select by
  group in one click.
- Let the user add many repos at once by picking multiple folders in one
  native file-dialog.
- Keep the existing Add / Remove / Edit flow working for users who don't
  care about groups — if there are no groups, the UI looks essentially
  the same as today.

## Non-goals

- Syncing groups across machines. Groups stay per-computer, same as
  `repo_search_repos` today.
- Drag-and-drop to reorder tabs. Alphabetical auto-sort only in v1.
- Bulk-editing repo attributes across groups. Edit stays per-chip.
- Migrating repo storage to proper DB tables. Stays as a JSON blob in
  `settings` for now; scheduled as a future refactor.

---

## Data model

### Group (new)

Stored as a JSON array in SQLite `settings` table, key
`repo_search_groups`, keyed per `computer_id` (matches the existing
`repo_search_repos` pattern in `desktop-rust/src-tauri/src/commands/repo_search.rs`).

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct RepoGroup {
    pub id: i64,            // auto-increment within the blob
    pub name: String,       // unique per computer, non-empty
    pub icon: String,       // 1-2 chars: emoji or free text; empty = no icon
    pub color: String,      // "#RRGGBB"
    pub sort_order: i32,    // currently unused — reserved for manual reorder
}
```

### RepoEntry (changed)

Extended to reference a group:

```rust
pub struct RepoEntry {
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(default)]           // backward-compat: old records deserialise fine
    pub group_id: Option<i64>,  // None = "Ungrouped"
}
```

### Migration

- First load after the update reads existing `repo_search_repos` and
  deserialises with `group_id = None` thanks to `#[serde(default)]`. No
  explicit migration step needed. Apply `#[serde(default)]` **only** to
  the new `group_id` field; do not touch existing fields.
- `repo_search_groups` key is absent on first load → treat as `[]`.

### Invariants

- Group `name` is unique per computer. `id` auto-increments (max existing
  + 1) when adding; survives rename but not recreation.
- Deleting a group sets `group_id = None` on every repo previously
  pointing at it. Both writes (`repo_search_groups` and
  `repo_search_repos`) happen under the same `DbState` mutex lock, so
  readers never observe the intermediate state. They are *not* wrapped
  in a single SQLite transaction — the store is two JSON blobs, atomicity
  is provided by the Rust-side mutex, matching how `add_repo` /
  `remove_repo` already work.
- A group can be empty (zero repos); still shown in the tab strip.
- `Ungrouped` is a **virtual** tab, not a stored group. It shows in the
  UI only when at least one repo has `group_id = None`.
- Backend treats `icon` as opaque and does **not** validate length or
  content. The 1–2 char limit is enforced in the mini-modal only. Empty
  string means "no icon".

---

## Backend — new/changed Tauri commands

Add to `desktop-rust/src-tauri/src/commands/repo_search.rs`:

| Command | Purpose |
| --- | --- |
| `list_repo_groups()` | Return `Vec<RepoGroup>` for current computer |
| `add_repo_group(name, icon, color)` | Append with new `id`; error if name taken |
| `update_repo_group(id, name, icon, color)` | Edit in place; error if name collides with another group |
| `remove_repo_group(id)` | Drop from list AND clear `group_id` on every repo that referenced it |

Extend existing / add new:

| Command | Change |
| --- | --- |
| `add_repo(name, path, color, group_id?)` | **Existing** — add optional `group_id` parameter |
| `update_repo(name, path, color, group_id?)` | **Net-new** — there is no `update_repo` today; the UI currently does remove+add to edit. Add this so the Edit-chip flow can change `group_id` / rename / recolour in one atomic call |
| `list_repos()` | Return `group_id` on each entry (already works once field is added) |

Editing `group_id` on an existing repo is in scope for v1 — accessed via
the chip's right-click → Edit. That is the whole reason `update_repo`
becomes net-new here rather than leaving the remove+add dance in place.

All new / extended commands registered in
`desktop-rust/src-tauri/src/lib.rs` `invoke_handler`.

**No schema migration needed** — storage is still the same `settings`
table, values are JSON.

---

## UI — `desktop-rust/src/tabs/repo-search.js`

### Tab strip (new, above the chip bar)

```
┌─────────────────────────────────────────────────────────────────┐
│  All    🗄 Databases    🔄 Airflow    🔧 Config    📁 Misc    + │   ← tab strip
├─────────────────────────────────────────────────────────────────┤
│  [chips of the active tab]                                       │   ← chip row (existing)
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

- Tabs: `All` first, then user groups sorted alphabetically, then
  `Ungrouped` last (only shown when at least one repo has no group).
- **Labels:** just `name` + optional leading icon. **No counts** in the
  label.
- Active tab has an accent under-line; inactive tabs are muted.
- `+` at the right end of the strip opens the **New Group** mini-modal.

### Active tab — inline select controls

Inside the active tab's underline area, two compact icon-buttons appear:

```
  🗄 Databases ✓ ⊘
  ─────────────────
```

- `✓` — activate every chip in the current tab's scope (group, or all
  chips on "All" tab, or all ungrouped on "Ungrouped").
- `⊘` — deactivate every chip in the same scope.
- Scope is always the active tab; there's no "global" select button.

### Chip row

- Shows only chips belonging to the active tab.
- Chip state (active / dim) is independent across tabs — leaving Databases
  with 2 active and switching to Airflow doesn't change Databases state.
- **Search uses only active chips of the active tab.** Going to "All" if
  you want cross-group search is explicit.

### Tab context menu (right-click on any group tab)

- **Edit group** → opens Edit Group mini-modal (same as New, but with
  pre-filled fields).
- **Delete group** → confirm → runs `remove_repo_group`; the group's
  repos reappear in the `Ungrouped` tab.

`All` and `Ungrouped` have no context menu (not editable, not deletable).

### New / Edit Group mini-modal

Fields:

- **Name** (required, unique)
- **Icon** — grid of 15 curated emojis plus a free-text field (1–2 chars).
  Curated set: 🗄 🔄 🌐 💻 📱 🔧 📄 ⚡ 🤖 📊 🔒 🧪 🚀 🎨 📁
- **Color** — 15-swatch palette + HTML `<input type="color">` for custom.

Uses the existing `showModal` component. On Save:
- New: calls `add_repo_group`, refreshes tabs, switches to the new tab.
- Edit: calls `update_repo_group`, refreshes tabs (stays on current).

### Add repo(s) — multi-select dialog

Flow when clicking the `+` button in the chip area (replaces current
single-folder Add button):

1. `tauri-plugin-dialog` `open({ multiple: true, directory: true })`
2. For each picked folder:
   - `name` = folder basename; if a repo with that name exists, append
     ` (2)` / ` (3)` until unique
   - `color` = random from the same 15-swatch palette used for groups
   - `group_id` = active tab's group id, or `None` if on "All" /
     "Ungrouped"
3. Call `add_repo` once per folder (in a loop — no bulk API needed).
4. Refresh chips.

There is no inline form and no modal for single-folder adds. Renaming /
recolouring / moving to a different group is done via right-click on
the chip (existing Edit flow, now using the new `update_repo` command).

**Note for release notes:** to add new repos to a specific group the
user must first switch to that tab. There is no in-dialog group picker
in v1. If you're on `All` or `Ungrouped`, the new repos go in with
`group_id = None` and land in `Ungrouped`.

---

## UX edge-cases handled

| Case | Behaviour |
| --- | --- |
| User deletes the tab they were on | Switch to `All` |
| User picks a folder that's already a repo | Toast error, skip it, continue with the rest |
| User creates a group with an icon the curated set already has | Allowed — icons are not unique, only names are |
| User edits a group and sets `icon` to empty | Tab shows only the name |
| Search triggered while current tab has zero active chips | Toast "No repos selected in {tab name}" — don't run the search |
| Right-click on `All` or `Ungrouped` | No-op (no context menu) |

---

## Files touched

| Path | Change |
| --- | --- |
| `desktop-rust/src-tauri/src/commands/repo_search.rs` | New `RepoGroup` struct, new CRUD commands, `group_id` on `RepoEntry`, cascading clear on group delete |
| `desktop-rust/src-tauri/src/lib.rs` | Register the 4 new commands |
| `desktop-rust/src/tabs/repo-search.js` | Rewrite the chip area: tab strip, active-tab inline buttons, context menu, new-group modal, multi-select add |
| `desktop-rust/src/dev-mock.js` | Mirror the 4 new group commands with localStorage persistence; extend the existing `add_repo` mock to accept `group_id`; add net-new `update_repo` mock |
| `desktop-rust/src/dev-test.py` | Add CDP tests: create group, add repos to group, select all/none within a tab, delete group → repos in Ungrouped |
| `desktop-rust/CHANGELOG.md` | New entry under next release |

No change to any Rust dependency. No change to CI or the OTA pipeline.

### Release channel

This change modifies `src-tauri/` (new Rust commands + registration), so
per `desktop-rust/RELEASES.md` §1 it must ship as a **full `v*` release**
— a frontend-only `f-*` tag won't carry the new backend. The UI changes
will land via the same release.

---

## Testing

### Manual
- Fresh install: no `repo_search_groups` key → tabs show only `All`
  (+ `Ungrouped` if user has any repos).
- Add group "Databases" → appears alphabetically between `All` and any
  later groups; switch to it; empty chip row.
- Add repos with `+`, multi-select 3 folders → 3 chips appear in
  "Databases" tab with basenames.
- `✓` / `⊘` buttons only affect current tab.
- Delete "Databases" → 3 chips now visible under `Ungrouped`.
- Edit group → rename / change icon / change color → reflected immediately.

### Automated (CDP)
- `desktop-rust/src/dev-test.py` grows 5 test cases:
  1. Create a group via `+` → mini-modal → appears in tab strip.
  2. Add 3 folders to the group → chips show up with correct defaults.
  3. Click `⊘` in active tab → all chips become dim; other tabs untouched.
  4. Delete group via right-click → chips re-appear in `Ungrouped`.
  5. When the active tab is deleted, the UI switches to `All` and the
     chip row renders without a crash.

### Local Tauri
Headless Docker screenshot test stays as-is — the new UI is a superset of
the existing one; the setup modal still renders first on a fresh profile,
so no baseline regression expected.

---

## Open questions / future work

- Drag-and-drop tab ordering (v2).
- Sync groups across devices (needs the sync API extension; v2).
- Migrating groups + repos from JSON blob into proper DB tables (planned
  refactor — user's explicit ask).
- Cross-group search from a non-`All` tab without manually navigating
  there (e.g. "search in Databases + Airflow") — low priority.
