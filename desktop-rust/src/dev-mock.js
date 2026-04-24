// Browser-only mock of window.__TAURI__ API for UI development.
// Loaded before main.js in dev.html. Not used in production build.

(function () {
  const LS_PREFIX = 'mock.';

  function storeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }
  function storeSet(key, value) {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }
  function nextId(key) {
    const k = LS_PREFIX + '__seq.' + key;
    const cur = parseInt(localStorage.getItem(k) || '0') + 1;
    localStorage.setItem(k, String(cur));
    return cur;
  }
  function now() { return new Date().toISOString(); }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function ensureFixtures() {
    if (storeGet('__init', false)) return;

    storeSet('exec_categories', [
      { id: 1, name: 'System', sort_order: 0 },
      { id: 2, name: 'Docker', sort_order: 1 },
    ]);
    storeSet('__seq.exec_categories', 2);
    storeSet('exec_commands', [
      { id: 1, category_id: 1, name: 'Disk usage', command: 'df -h', description: 'Show disk usage', sort_order: 0, hide_after_run: false },
      { id: 2, category_id: 1, name: 'Uptime', command: 'uptime', description: '', sort_order: 1, hide_after_run: false },
      { id: 3, category_id: 2, name: 'Docker ps', command: 'docker ps', description: 'List running containers', sort_order: 0, hide_after_run: false },
    ]);
    storeSet('__seq.exec_commands', 3);

    storeSet('snippet_tags', [
      { id: 1, name: 'sql', patterns: '*sql*', color: '#3b82f6', sort_order: 0 },
      { id: 2, name: 'py', patterns: '*.py|py_*', color: '#10b981', sort_order: 1 },
    ]);
    storeSet('__seq.snippet_tags', 2);
    storeSet('shortcuts', [
      { id: 1, uuid: uuid(), name: 'SELECT all', value: 'SELECT * FROM {{table}};', description: 'SQL sample',
        links: [{ id: 1, title: 'docs', url: 'https://postgresql.org' }], obsidian_note: null, created_at: now(), updated_at: now() },
      { id: 2, uuid: uuid(), name: 'Python hello', value: 'print("hello")', description: 'Simple script',
        links: [], obsidian_note: null, created_at: now(), updated_at: now() },
    ]);
    storeSet('__seq.shortcuts', 2);

    storeSet('note_folders', [
      { id: 1, name: 'Inbox', sort_order: 0, parent_id: null },
      { id: 2, name: 'Projects', sort_order: 1, parent_id: null },
      { id: 3, name: 'Keyboard Helper', sort_order: 0, parent_id: 2 },
    ]);
    storeSet('__seq.note_folders', 3);
    storeSet('notes', [
      { id: 1, uuid: uuid(), folder_id: 1, title: 'Shopping list', body: '- milk\n- bread', pinned: 0, created_at: now(), updated_at: now() },
      { id: 2, uuid: uuid(), folder_id: 3, title: 'OTA plan', body: '# Plan\n1. design\n2. build', pinned: 1, created_at: now(), updated_at: now() },
    ]);
    storeSet('__seq.notes', 2);

    storeSet('vps_environments', [
      { name: 'Default', sort_order: 0 },
      { name: 'Production', sort_order: 1 },
    ]);
    storeSet('vps_servers', [
      { name: 'api-prod', host: '10.0.0.1', user: 'deploy', port: 22, key_file: '~/.ssh/id_rsa',
        color: '#3b82f6', auto_refresh: true, refresh_interval: 30, environment: 'Production' },
      { name: 'dev-box', host: '192.168.1.50', user: 'dev', port: 22, key_file: '',
        color: '#10b981', auto_refresh: false, refresh_interval: 60, environment: 'Default' },
    ]);

    storeSet('commit_tags', [
      { id: 1, computer_id: 'mock-computer', tag_name: 'отчет', is_default: 1 },
      { id: 2, computer_id: 'mock-computer', tag_name: 'таблица', is_default: 0 },
    ]);
    storeSet('__seq.commit_tags', 2);
    storeSet('commit_history', []);

    storeSet('repos', [
      { name: 'snippets_helper', path: '/home/dev/snippets_helper', color: '#3b82f6', group_id: null },
      { name: 'dags-core',       path: '/home/dev/dags-core',       color: '#10b981', group_id: null },
      { name: 'pg-analytics',    path: '/home/dev/pg-analytics',    color: '#f59e0b', group_id: null },
    ]);

    storeSet('analyzer_templates', []);
    storeSet('__seq.analyzer_templates', 0);
    storeSet('macrosing_templates', []);
    storeSet('__seq.macrosing_templates', 0);

    storeSet('settings', {
      font_size: '14',
      last_active_tab: 'shortcuts',
      ui_language: 'ru',
      computer_id: 'mock-computer',
      computer_name: 'mock-dev',
      setup_complete: '1',
      snippets_font_size: '12',
      snippets_left_width: '220',
      snippet_expand_multiplier: '2',
      search_context_lines: '3',
      sync_api_url: 'https://ister-app.ru/snippets-api',
      sync_api_key: 'mock-key',
    });

    storeSet('__init', true);
  }

  function updateItem(table, id, patch) {
    const items = storeGet(table, []);
    const idx = items.findIndex(x => x.id === id);
    if (idx < 0) throw new Error(`Not found: ${table}#${id}`);
    items[idx] = { ...items[idx], ...patch, updated_at: now() };
    storeSet(table, items);
    return items[idx];
  }
  function deleteItem(table, id) {
    const items = storeGet(table, []);
    const next = items.filter(x => x.id !== id);
    storeSet(table, next);
  }
  function createItem(table, data) {
    const items = storeGet(table, []);
    const id = nextId(table);
    const item = { id, created_at: now(), updated_at: now(), ...data };
    items.push(item);
    storeSet(table, items);
    return item;
  }

  // ----- whisper mocks -----
  const whisperMockState = {
    installedModels: [],
    history: [],
    currentState: 'idle',
    levelTimer: null,
  };

  const whisperCatalog = [
    { name: 'ggml-tiny',          display_name: 'tiny',                 size_bytes: 77691712,   sha256: 'x', download_url: '', ru_quality: 1, recommended: false, notes: 'Fast but poor for Russian' },
    { name: 'ggml-base',          display_name: 'base',                 size_bytes: 147951616,  sha256: 'x', download_url: '', ru_quality: 2, recommended: false, notes: 'Weak for Russian' },
    { name: 'ggml-small',         display_name: 'small (multilingual)', size_bytes: 487601967,  sha256: 'x', download_url: '', ru_quality: 4, recommended: true,  notes: 'Best tradeoff for RU+EN' },
    { name: 'ggml-medium',        display_name: 'medium',               size_bytes: 1533763059, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Top quality if RAM allows' },
    { name: 'ggml-large-v3',      display_name: 'large-v3',             size_bytes: 3095018317, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Best quality, GPU recommended' },
    { name: 'ggml-large-v3-q5_0', display_name: 'large-v3 (Q5)',        size_bytes: 1080000000, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Quantized: large-quality at ~1GB' },
  ];

  const handlers = {
    // ── Settings ────────────────────────────────────────
    async get_setting({ key }) {
      const s = storeGet('settings', {});
      return s[key] ?? null;
    },
    async set_setting({ key, value }) {
      const s = storeGet('settings', {});
      s[key] = value;
      storeSet('settings', s);
    },
    async set_always_on_top() { },
    async hide_and_sync() { console.log('[mock] hide_and_sync'); },

    // ── Shortcuts ───────────────────────────────────────
    async list_shortcuts() { return storeGet('shortcuts', []); },
    async search_shortcuts({ query }) {
      const q = (query || '').toLowerCase();
      return storeGet('shortcuts', []).filter(s =>
        s.name.toLowerCase().includes(q) || (s.value || '').toLowerCase().includes(q));
    },
    async filter_shortcuts({ patterns, query }) {
      const items = storeGet('shortcuts', []);
      const regexes = (patterns || '').split('|').filter(Boolean).map(p =>
        new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
      const q = (query || '').toLowerCase();
      return items.filter(s => {
        const nameMatch = regexes.length === 0 || regexes.some(r => r.test(s.name));
        const qMatch = !q || s.name.toLowerCase().includes(q) || (s.value || '').toLowerCase().includes(q);
        return nameMatch && qMatch;
      });
    },
    async create_shortcut(args) {
      return createItem('shortcuts', { uuid: uuid(), ...args, obsidian_note: null });
    },
    async update_shortcut({ id, ...patch }) { return updateItem('shortcuts', id, patch); },
    async delete_shortcut({ id }) { deleteItem('shortcuts', id); },
    async list_snippet_tags() { return storeGet('snippet_tags', []); },
    async create_snippet_tag(args) { return createItem('snippet_tags', { uuid: uuid(), ...args }); },
    async update_snippet_tag({ id, ...patch }) { return updateItem('snippet_tags', id, patch); },
    async delete_snippet_tag({ id }) { deleteItem('snippet_tags', id); },
    async open_link_window({ url }) { console.log('[mock] open_link_window', url); window.open(url, '_blank'); },

    // ── Obsidian ────────────────────────────────────────
    async list_obsidian_vaults() { return []; },
    async list_obsidian_folders() { return []; },
    async list_obsidian_files() { return []; },
    async create_obsidian_note() { throw new Error('Obsidian not configured in mock'); },
    async read_obsidian_note() { return '# Mock note\n\nContent not available in dev mock.'; },
    async link_obsidian_note({ snippetId, notePath }) {
      return updateItem('shortcuts', snippetId, { obsidian_note: notePath || null });
    },

    // ── Clipboard / URL ─────────────────────────────────
    async copy_to_clipboard({ text }) { navigator.clipboard.writeText(text).catch(() => {}); },
    async read_clipboard() { try { return await navigator.clipboard.readText(); } catch { return ''; } },
    async open_url({ url }) { window.open(url, '_blank'); },

    // ── Sync / Update ───────────────────────────────────
    async trigger_sync() {
      return { timestamp: now(), push: { total: 0, shortcuts: 0, notes: 0 }, pull: { total: 0, shortcuts: 0, notes: 0 } };
    },
    async register_sync({ apiUrl, name }) { return { api_key: 'mock-key-' + name, computer_id: 'mock-cid' }; },
    async check_sync_health() { return { ok: true, latency_ms: 15 }; },
    async check_for_update() {
      return { has_update: false, build_in_progress: false, current_version: '0.9.5', latest_version: '0.9.5' };
    },
    async get_frontend_version() { return '0.9.5-f1'; },
    async check_frontend_update() {
      return { has_update: false, current_version: '0.9.5-f1', latest_version: '0.9.5-f1', url: null, signature: null, sha256: null };
    },
    async download_frontend_update() { return; },
    async apply_frontend_update() { return; },
    async revert_frontend() { return '0.9.5-f0'; },
    async drop_frontend_override() { return; },
    async confirm_frontend_boot() { return; },
    async debug_sync() { return { tables: {} }; },
    async force_full_sync() { return { reset: true, pull: { total: 0 } }; },

    // ── Notes ───────────────────────────────────────────
    async list_note_folders() { return storeGet('note_folders', []); },
    async create_note_folder(args) { return createItem('note_folders', args); },
    async update_note_folder({ id, ...patch }) { return updateItem('note_folders', id, patch); },
    async delete_note_folder({ id }) {
      deleteItem('note_folders', id);
      const notes = storeGet('notes', []).filter(n => n.folder_id !== id);
      storeSet('notes', notes);
    },
    async list_notes({ folderId }) {
      return storeGet('notes', []).filter(n => folderId == null || n.folder_id === folderId);
    },
    async create_note(args) { return createItem('notes', { uuid: uuid(), ...args }); },
    async update_note({ id, ...patch }) { return updateItem('notes', id, patch); },
    async delete_note({ id }) { deleteItem('notes', id); },

    // ── SQL tools ───────────────────────────────────────
    async parse_sql_tables({ sql }) {
      const tables = [...new Set((sql || '').match(/\b(?:from|join|update|into)\s+([a-zA-Z_][\w.]*)/gi) || [])]
        .map(m => m.split(/\s+/)[1]);
      return tables;
    },
    async format_sql({ sql }) { return [sql, null]; },
    async obfuscate_sql({ sql }) { return { sql, mappings: {} }; },
    async analyze_ddl({ ddl }) { return { columns: [], analysis: 'mock' }; },
    async generate_macros() { return { output: 'mock macros' }; },
    async list_analyzer_templates() { return storeGet('analyzer_templates', []); },
    async create_analyzer_template({ templateText }) { return createItem('analyzer_templates', { template_text: templateText }); },
    async delete_analyzer_template({ id }) { deleteItem('analyzer_templates', id); },
    async list_macrosing_templates() { return storeGet('macrosing_templates', []); },
    async create_macrosing_template(args) { return createItem('macrosing_templates', args); },
    async update_macrosing_template({ id, ...patch }) { return updateItem('macrosing_templates', id, patch); },
    async delete_macrosing_template({ id }) { deleteItem('macrosing_templates', id); },

    // ── Superset ────────────────────────────────────────
    async extract_superset_zip() { return []; },
    async validate_superset_report() { return []; },
    async parse_superset_sql() { return '-- mock sql'; },

    // ── Commits ─────────────────────────────────────────
    async list_commit_history({ computerId }) {
      return storeGet('commit_history', []).filter(h => h.computer_id === computerId);
    },
    async create_commit_history(args) { return createItem('commit_history', args); },
    async delete_commit_history({ id }) { deleteItem('commit_history', id); },
    async list_commit_tags({ computerId }) {
      return storeGet('commit_tags', []).filter(t => t.computer_id === computerId);
    },
    async create_commit_tag(args) { return createItem('commit_tags', args); },
    async delete_commit_tag({ id }) { deleteItem('commit_tags', id); },

    // ── Exec ────────────────────────────────────────────
    async list_exec_categories() {
      return storeGet('exec_categories', []).sort((a, b) => a.sort_order - b.sort_order);
    },
    async create_exec_category({ name, sortOrder }) {
      return createItem('exec_categories', { name, sort_order: sortOrder ?? 0 });
    },
    async update_exec_category({ id, name, sortOrder }) {
      return updateItem('exec_categories', id, { name, sort_order: sortOrder });
    },
    async delete_exec_category({ id }) {
      deleteItem('exec_categories', id);
      const cmds = storeGet('exec_commands', []).filter(c => c.category_id !== id);
      storeSet('exec_commands', cmds);
    },
    async list_exec_commands({ categoryId }) {
      return storeGet('exec_commands', []).filter(c => c.category_id === categoryId)
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    async create_exec_command({ categoryId, name, command, description, sortOrder, hideAfterRun }) {
      return createItem('exec_commands', {
        category_id: categoryId, name, command, description: description || '',
        sort_order: sortOrder ?? 0, hide_after_run: !!hideAfterRun,
      });
    },
    async update_exec_command({ id, name, command, description, sortOrder, hideAfterRun }) {
      return updateItem('exec_commands', id, {
        name, command, description: description || '',
        sort_order: sortOrder ?? 0, hide_after_run: !!hideAfterRun,
      });
    },
    async delete_exec_command({ id }) { deleteItem('exec_commands', id); },
    async run_command({ command }) {
      await new Promise(r => setTimeout(r, 300));
      return `[mock] ${command}\nOK — executed in 0.3s\n(real shell disabled in browser)`;
    },
    async stop_command() { },

    // ── Help ────────────────────────────────────────────
    async get_changelog() { return '# Changelog\n\n## v0.9.5 (mock)\n- dev mock fixtures'; },

    // ── Repo Search ─────────────────────────────────────
    async list_repos() { return storeGet('repos', []); },
    async add_repo({ name, path, color, groupId }) {
      const repos = storeGet('repos', []);
      if (repos.some(r => r.name === name)) throw new Error(`Repo '${name}' already exists`);
      repos.push({ name, path, color, group_id: groupId ?? null });
      storeSet('repos', repos);
    },
    async remove_repo({ name }) {
      storeSet('repos', storeGet('repos', []).filter(r => r.name !== name));
    },
    // Groups
    async list_repo_groups() {
      return storeGet('repo_groups', []);
    },
    async add_repo_group({ name, icon, color }) {
      if (!name || !name.trim()) throw new Error('Name is required');
      const groups = storeGet('repo_groups', []);
      if (groups.some(g => g.name === name)) throw new Error(`Group '${name}' already exists`);
      const id = (groups.reduce((m, g) => Math.max(m, g.id), 0)) + 1;
      const group = { id, name, icon: icon || '', color: color || '#3b82f6', sort_order: 0 };
      groups.push(group);
      storeSet('repo_groups', groups);
      return group;
    },
    async update_repo_group({ id, name, icon, color }) {
      const groups = storeGet('repo_groups', []);
      if (groups.some(g => g.name === name && g.id !== id)) throw new Error(`Group '${name}' already exists`);
      const g = groups.find(g => g.id === id);
      if (!g) throw new Error(`Group #${id} not found`);
      g.name = name; g.icon = icon; g.color = color;
      storeSet('repo_groups', groups);
    },
    async remove_repo_group({ id }) {
      // Cascade
      const repos = storeGet('repos', []).map(r => r.group_id === id ? { ...r, group_id: null } : r);
      storeSet('repos', repos);
      const groups = storeGet('repo_groups', []).filter(g => g.id !== id);
      storeSet('repo_groups', groups);
    },
    async update_repo({ oldName, name, path, color, groupId }) {
      const repos = storeGet('repos', []);
      if (repos.some(r => r.name === name && r.name !== oldName)) throw new Error(`Repo '${name}' already exists`);
      const r = repos.find(x => x.name === oldName);
      if (!r) throw new Error(`Repo '${oldName}' not found`);
      r.name = name; r.path = path; r.color = color; r.group_id = groupId ?? null;
      storeSet('repos', repos);
    },
    async search_filenames() { return []; },
    async search_content() { return []; },
    async search_git_history() { return []; },
    async get_file_context() { return []; },

    // v1.2.0 tools
    async open_in_editor({ path, line }) {
      console.log('[mock] open_in_editor', { path, line });
    },
    async read_full_file({ path }) {
      const lang = (path.split('.').pop() || '').toLowerCase();
      const samples = {
        md: '# Sample markdown\n\nA mock file — in prod this reads the real disk.',
        txt: 'plain text sample\nline two\nline three',
        js: 'function hello(name) {\n  return `Hello, ${name}!`;\n}',
        py: 'def hello(name):\n    return f"Hello, {name}!"',
      };
      const content = samples[lang] || `# ${path}\n(mock content for dev)`;
      return { content, truncated: false, size: content.length };
    },
    async repo_search_status() {
      return storeGet('repo_statuses', [
        { name: 'snippets_helper', branch: 'main', last_commit_subject: 'add groups', last_commit_iso: '2026-04-21T11:20:00+00:00', is_dirty: false, error: null },
        { name: 'dags-core',       branch: 'feature/etl', last_commit_subject: 'WIP', last_commit_iso: '2026-04-20T09:00:00+00:00', is_dirty: true,  error: null },
        { name: 'pg-analytics',    branch: 'main', last_commit_subject: 'bump pg driver', last_commit_iso: '2026-04-19T18:14:00+00:00', is_dirty: false, error: null },
      ]);
    },
    async repo_search_pull_main({ paths, dryRun }) {
      const statuses = await this.repo_search_status();
      const pathToName = new Map((storeGet('repos', [])).map(r => [r.path, r.name]));
      return paths.map(p => {
        const name = pathToName.get(p) || p;
        const s = statuses.find(x => x.name === name);
        if (s && s.is_dirty) {
          return { name, skipped: true, success: false, message: 'uncommitted changes', commands_run: [] };
        }
        const cmds = [`git checkout ${s?.branch || 'main'}`, 'git pull --ff-only'];
        if (dryRun) return { name, skipped: false, success: true, message: 'dry-run', commands_run: cmds };
        return { name, skipped: false, success: true, message: 'Already up to date.', commands_run: cmds };
      });
    },
    async repo_search_commit_diff({ repoPath, hash, fullContext }) {
      const hdr = `commit ${hash}\nAuthor: Mock User <mock@example.com>\nDate:   ${now()}\n\n    mock subject\n\n`;
      if (fullContext) {
        return hdr + `diff --git a/src/mock.py b/src/mock.py\n@@ -1,15 +1,15 @@\n-def old():\n+def new():\n     return 42\n\n     x = 1\n     y = 2\n     z = 3\n     a = 4\n     b = 5\n     c = 6\n     d = 7\n     e = 8\n     f = 9\n     g = 10\n     h = 11\n`;
      }
      return hdr + `diff --git a/src/mock.py b/src/mock.py\n@@ -1,3 +1,3 @@\n-def old():\n+def new():\n     return 42\n`;
    },
    async repo_search_reset_hard({ path, clean }) {
      const pathToName = new Map((storeGet('repos', [])).map(r => [r.path, r.name]));
      const name = pathToName.get(path);
      const statuses = storeGet('repo_statuses', null);
      if (statuses && name) {
        const next = statuses.map(s => s.name === name ? { ...s, is_dirty: false } : s);
        storeSet('repo_statuses', next);
      }
      const cleaned = clean !== false;
      return {
        output: `HEAD is now at abc1234 (mock reset)${cleaned ? '\nRemoving scratch.txt' : ''}`,
        dirty_before: true,
        dirty_after: false,
        cleaned,
      };
    },

    // ── VPS ─────────────────────────────────────────────
    async list_vps_environments() { return storeGet('vps_environments', []); },
    async add_vps_environment({ name }) {
      const envs = storeGet('vps_environments', []);
      envs.push({ name, sort_order: envs.length });
      storeSet('vps_environments', envs);
    },
    async rename_vps_environment({ oldName, newName }) {
      const envs = storeGet('vps_environments', []).map(e => e.name === oldName ? { ...e, name: newName } : e);
      storeSet('vps_environments', envs);
      const srv = storeGet('vps_servers', []).map(s => s.environment === oldName ? { ...s, environment: newName } : s);
      storeSet('vps_servers', srv);
    },
    async remove_vps_environment({ name }) {
      storeSet('vps_environments', storeGet('vps_environments', []).filter(e => e.name !== name));
    },
    async reorder_vps_environments({ names }) {
      const envs = storeGet('vps_environments', []);
      storeSet('vps_environments', names.map((n, i) => {
        const e = envs.find(x => x.name === n) || { name: n };
        return { ...e, sort_order: i };
      }));
    },
    async list_vps_servers() { return storeGet('vps_servers', []); },
    async add_vps_server({ server }) {
      const servers = storeGet('vps_servers', []);
      servers.push(server);
      storeSet('vps_servers', servers);
    },
    async update_vps_server({ index, server }) {
      const servers = storeGet('vps_servers', []);
      servers[index] = server;
      storeSet('vps_servers', servers);
    },
    async remove_vps_server({ index }) {
      const servers = storeGet('vps_servers', []);
      servers.splice(index, 1);
      storeSet('vps_servers', servers);
    },
    async move_vps_server({ index, targetEnv }) {
      const servers = storeGet('vps_servers', []);
      if (servers[index]) servers[index].environment = targetEnv;
      storeSet('vps_servers', servers);
    },
    async vps_get_stats() {
      return {
        cpu_percent: Math.round(Math.random() * 60),
        mem_percent: Math.round(Math.random() * 80),
        disk_percent: Math.round(Math.random() * 90),
        uptime: 'up 3 days, 4:12',
        load_avg: '0.50, 0.42, 0.30',
      };
    },
    async vps_test_connection() { return 'mock-hostname'; },

    // ── Autostart ───────────────────────────────────────
    async get_autostart() { return false; },
    async set_autostart() { },

    // ── Whisper ─────────────────────────────────────────
    whisper_list_catalog() { return whisperCatalog; },
    whisper_list_models() { return whisperMockState.installedModels.slice(); },
    async whisper_install_model({ name }) {
      const meta = whisperCatalog.find(m => m.name === name);
      if (!meta) throw new Error('unknown model');
      let done = 0;
      const total = meta.size_bytes;
      const tick = 50;
      const stepBytes = Math.max(1, Math.floor(total / 40));
      return new Promise((resolve) => {
        const iv = setInterval(() => {
          done = Math.min(total, done + stepBytes);
          window.dispatchEvent(new CustomEvent('whisper:model-download', {
            detail: { model: name, bytes_done: done, bytes_total: total, speed_bps: stepBytes * (1000 / tick), finished: done === total, error: null }
          }));
          if (done >= total) {
            clearInterval(iv);
            const installed = {
              id: whisperMockState.installedModels.length + 1,
              name: meta.name, display_name: meta.display_name,
              file_path: `/mock/${meta.name}.bin`, size_bytes: meta.size_bytes,
              sha256: meta.sha256, is_default: whisperMockState.installedModels.length === 0,
              installed_at: Math.floor(Date.now() / 1000),
            };
            whisperMockState.installedModels.push(installed);
            resolve(installed);
          }
        }, tick);
      });
    },
    whisper_delete_model({ name }) {
      whisperMockState.installedModels = whisperMockState.installedModels.filter(m => m.name !== name);
      return null;
    },
    whisper_set_default_model({ name }) {
      whisperMockState.installedModels = whisperMockState.installedModels.map(m => ({ ...m, is_default: m.name === name }));
      return null;
    },
    whisper_start_recording() {
      whisperMockState.currentState = 'recording';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'recording', model: 'ggml-small' } }));
      whisperMockState.levelTimer = setInterval(() => {
        const rms = 0.2 + 0.5 * Math.abs(Math.sin(Date.now() / 120));
        window.dispatchEvent(new CustomEvent('whisper:level', { detail: { rms } }));
      }, 50);
      return null;
    },
    async whisper_stop_recording() {
      if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
      whisperMockState.levelTimer = null;
      whisperMockState.currentState = 'transcribing';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'transcribing', model: 'ggml-small' } }));
      await new Promise(r => setTimeout(r, 400));
      const text = 'Mocked transcript: это тестовая запись, привет мир.';
      whisperMockState.history.unshift({
        id: Date.now(), text, text_raw: null, model_name: 'ggml-small',
        duration_ms: 3000, transcribe_ms: 400, language: 'ru', injected_to: 'paste',
        created_at: Math.floor(Date.now() / 1000),
      });
      whisperMockState.currentState = 'ready';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'ready', model: 'ggml-small' } }));
      window.dispatchEvent(new CustomEvent('whisper:transcribed', { detail: { text, duration_ms: 3000, transcribe_ms: 400, model: 'ggml-small', language: 'ru' } }));
      return text;
    },
    whisper_cancel_recording() {
      if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
      whisperMockState.levelTimer = null;
      whisperMockState.currentState = 'idle';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'idle', model: null } }));
      return null;
    },
    whisper_unload_now() {
      whisperMockState.currentState = 'idle';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'idle', model: null } }));
      return null;
    },
    whisper_inject_text({ text, method }) { return method || 'copy'; },
    whisper_get_history({ limit }) { return whisperMockState.history.slice(0, limit || 200); },
    whisper_delete_history({ id }) {
      if (id === null || id === undefined) whisperMockState.history = [];
      else whisperMockState.history = whisperMockState.history.filter(h => h.id !== id);
      return null;
    },
    whisper_list_mics() {
      return [
        { name: 'MacBook Pro Microphone', is_default: true },
        { name: 'External USB Mic', is_default: false },
      ];
    },
    whisper_gpu_info() {
      return { cpu_model: 'Apple M2 Pro', ram_mb: 16384, cuda: false, metal: true, vram_mb: 0 };
    },
    whisper_detect_whisper_bin() {
      return { variant: 'metal', installed: true, path: null, dl_url: null, dl_size_bytes: null };
    },
  };

  ensureFixtures();

  async function invoke(command, args = {}) {
    const h = handlers[command];
    if (!h) {
      console.warn('[mock] Unhandled command:', command, args);
      return null;
    }
    try {
      return await h(args);
    } catch (e) {
      console.error('[mock] handler error:', command, e);
      throw e;
    }
  }

  window.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (evt, cb) => {
        const h = (e) => cb({ payload: e.detail });
        window.addEventListener(evt, h);
        return () => window.removeEventListener(evt, h);
      },
      emit: async () => {},
    },
  };

  console.log('[dev-mock] window.__TAURI__ stubbed with', Object.keys(handlers).length, 'handlers');
})();
