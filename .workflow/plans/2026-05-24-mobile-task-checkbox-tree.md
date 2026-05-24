# Mobile Task Checkbox Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render synced nested task checkboxes correctly in the mobile task editor.

**Architecture:** Add a pure `flattenCheckboxTree(items)` helper near the mobile task repository code and use it in `TaskEditorScreen`. The helper returns visible checkbox rows in deterministic depth-first order with a `depth` value for indentation; editing still updates the original checkbox rows by UUID.

**Tech Stack:** React Native JavaScript, Jest, existing SQLite task repo helpers, mobile OTA release flow.

---

### Task 1: Tree Flattening Helper

**Files:**
- Modify: `mobile/src/db/taskRepo.js`
- Modify: `mobile/__tests__/db/taskRepo.test.js`

- [x] **Step 1: Write failing tests**

Add tests covering depth-first ordering, orphan fallback to root, deleted rows,
and cycle safety:

```js
import { flattenCheckboxTree } from '../../src/db/taskRepo';

test('flattenCheckboxTree returns depth-first hierarchy with depths', () => {
  const rows = [
    { uuid: 'child-2', parent_uuid: 'root-1', text: 'B', sort_order: 1, is_deleted: 0 },
    { uuid: 'root-2', parent_uuid: null, text: 'Root 2', sort_order: 1, is_deleted: 0 },
    { uuid: 'grandchild-1', parent_uuid: 'child-1', text: 'AA', sort_order: 0, is_deleted: 0 },
    { uuid: 'root-1', parent_uuid: null, text: 'Root 1', sort_order: 0, is_deleted: 0 },
    { uuid: 'child-1', parent_uuid: 'root-1', text: 'A', sort_order: 0, is_deleted: 0 },
  ];

  expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
    ['root-1', 0],
    ['child-1', 1],
    ['grandchild-1', 2],
    ['child-2', 1],
    ['root-2', 0],
  ]);
});

test('flattenCheckboxTree renders orphans once at root level', () => {
  const rows = [
    { uuid: 'orphan', parent_uuid: 'missing', text: 'Orphan', sort_order: 1, is_deleted: 0 },
    { uuid: 'root', parent_uuid: null, text: 'Root', sort_order: 0, is_deleted: 0 },
  ];

  expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
    ['root', 0],
    ['orphan', 0],
  ]);
});

test('flattenCheckboxTree skips deleted rows and avoids cycles', () => {
  const rows = [
    { uuid: 'deleted', parent_uuid: null, text: 'Deleted', sort_order: 0, is_deleted: 1 },
    { uuid: 'a', parent_uuid: 'b', text: 'A', sort_order: 0, is_deleted: 0 },
    { uuid: 'b', parent_uuid: 'a', text: 'B', sort_order: 0, is_deleted: 0 },
  ];

  expect(flattenCheckboxTree(rows).map(({ item, depth }) => [item.uuid, depth])).toEqual([
    ['a', 0],
    ['b', 0],
  ]);
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
```

Expected: fails because `flattenCheckboxTree` is missing.

- [x] **Step 3: Implement helper**

Add `flattenCheckboxTree(items)` to `mobile/src/db/taskRepo.js`:

- filter out `is_deleted`;
- sort siblings by `sort_order`, then `text`, then `uuid`;
- traverse roots first in depth-first order;
- append unvisited/cyclic rows once at root depth.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd mobile && npm test -- --runTestsByPath __tests__/db/taskRepo.test.js
```

Expected: task repo tests pass.

### Task 2: Render Tree In Task Editor

**Files:**
- Modify: `mobile/src/screens/Tasks/TaskEditorScreen.js`

- [x] **Step 1: Use helper in screen**

Import `flattenCheckboxTree` and replace the flat `visibleCheckboxes.map(...)`
render with flattened tree rows:

```js
const visibleCheckboxTree = flattenCheckboxTree(checkboxes);
```

Render each row's `item` with left indentation derived from `depth`.

- [x] **Step 2: Keep editing semantics unchanged**

Ensure these existing handlers still update/delete by `item.uuid`:

- toggle checked state;
- text edit;
- delete item subtree through `collectCheckboxSubtree`;
- save all rows.

- [x] **Step 3: Verify screen parses**

Run:

```bash
node --check mobile/src/screens/Tasks/TaskEditorScreen.js
```

Expected: no syntax errors.

### Task 3: OTA Release 1.0.12

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [x] **Step 1: Bump mobile version**

Set mobile package version from `1.0.11` to `1.0.12` in both version files.

- [x] **Step 2: Run mobile tests**

Run:

```bash
cd mobile && npm test -- --runInBand
```

Expected: all mobile Jest tests pass.

- [x] **Step 3: Build OTA bundle**

Run React Native bundle into a temporary `/tmp/ota-bundle-1.0.12-codex/output`
folder and zip the top-level `output/` folder.

- [x] **Step 4: Upload OTA and manifest**

Upload `/tmp/bundle-1.0.12-codex.zip` to:

```text
snippets-api:/opt/isterapp/releases/snippets-updates/bundle-1.0.12.zip
```

Set `latest.json` to:

```json
{"version":"1.0.12","bundle_url":"https://ister-app.ru/snippets-updates/bundle-1.0.12.zip","release_notes":"Render nested task checkboxes as a hierarchy on mobile."}
```

- [x] **Step 5: Verify release**

Run:

```bash
wget -qO- https://ister-app.ru/snippets-updates/latest.json
wget -S --spider https://ister-app.ru/snippets-updates/bundle-1.0.12.zip
POST_RELEASE_API_BASE_URL=https://ister-app.ru/snippets-api POST_RELEASE_REGISTER_USER=1 POST_RELEASE_DESKTOP_TAG=v1.3.29 POST_RELEASE_MOBILE_VERSION=1.0.12 bash tests/post_release/run.sh -q
```

Expected: manifest returns `1.0.12`, bundle exists, smoke tests pass.

- [ ] **Step 6: Commit and push**

Commit code, spec, plan, and checkpoint:

```bash
git add .workflow/checkpoints/2026-05-24-mobile-tasks-sync-followup-checkpoint.md .workflow/specs/2026-05-24-mobile-task-checkbox-tree.md .workflow/plans/2026-05-24-mobile-task-checkbox-tree.md mobile/src/db/taskRepo.js mobile/__tests__/db/taskRepo.test.js mobile/src/screens/Tasks/TaskEditorScreen.js mobile/package.json mobile/package-lock.json
git commit -m "render mobile task checkbox tree (OTA 1.0.12)"
git push origin main
```
