export const REPO_SEARCH_HELP_HTML = `
  <h4>Repo Search</h4>
  <p>
    Repo Search searches across configured local git repositories. Use group
    tabs to scope the repository set, repository chips to include or exclude
    individual repos, and the Search / Manage tabs for search and maintenance
    workflows.
  </p>

  <h4>Search modes</h4>
  <ul>
    <li><strong>Files</strong> finds files by filename patterns.</li>
    <li><strong>Content</strong> searches file contents. Open a result and use
    Expand to inspect the full file with syntax highlighting, local in-file
    search, highlighted matching lines, and next/previous match navigation.
    The expanded header also has History for commit metadata and per-file
    diff previews.</li>
    <li><strong>Git</strong> searches commit messages and changed patch lines.</li>
  </ul>

  <h4>Groups and repositories</h4>
  <p>
    Group tabs and repository chips can be reordered by drag-and-drop. Drag a
    repository chip onto a group tab to move the repo into that group. The scope
    badge in the Search tab shows which group and how many active repos will be
    searched.
  </p>

  <h4>Manage</h4>
  <p>
    The Manage tab checks branch/status information for the active scope and can
    pull all scoped repositories to main. Use dry-run to preview planned git
    commands before running them.
  </p>

  <h4>Settings</h4>
  <p>
    The gear button in the module header opens repository settings. Add, edit,
    or remove repository entries there, and adjust search context lines.
  </p>
`;
