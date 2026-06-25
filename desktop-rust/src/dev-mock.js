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
  function nowMs() { return Date.now(); }
  function emitMockEvent(name, payload) {
    window.dispatchEvent(new CustomEvent(name, { detail: payload }));
  }
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
      {
        id: 1,
        uuid: uuid(),
        name: 'SELECT all',
        value: 'SELECT * FROM {{table}};',
        description: 'SQL sample',
        links: [{ id: 1, title: 'PostgreSQL docs', url: 'https://postgresql.org' }],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 2,
        uuid: uuid(),
        name: 'Python markdown block',
        value: 'Run this:\n\n```python\nprint("hello")\nprint("world")\n```',
        description: '## Usage\n\nOpen the Links tab for docs.',
        links: [
          { id: 1, title: 'Python docs', url: 'https://docs.python.org/3/' },
          { id: 2, title: 'Runbook', url: 'https://wiki.local/runbooks/python' },
        ],
        obsidian_note: 'MockVault/Snippets/python.md',
        is_pinned: true,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 3,
        uuid: uuid(),
        name: 'Minimal plain snippet',
        value: 'plain text only',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 4,
        uuid: uuid(),
        name: 'Indented fenced blocks',
        value: 'Indented fences:\n\n   ```bash\n   echo ok\n   ```\n\n```sql\nselect 1;\n```\n\n```\nplain text\n```',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 5,
        uuid: uuid(),
        name: 'bash_cd_guide',
        value: 'cd /srv/app',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 6,
        uuid: uuid(),
        name: 'bash_cd_cheatsheet',
        value: 'pwd && ls -la',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 7,
        uuid: uuid(),
        name: 'bash_ssh_guide',
        value: 'ssh user@host',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 8,
        uuid: uuid(),
        name: 'sql_guide',
        value: 'select 1;',
        description: '',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 9,
        uuid: uuid(),
        name: 'code_picker_alpha',
        value: 'console.log("alpha");',
        description: 'Picker sample',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 10,
        uuid: uuid(),
        name: 'code_picker_beta',
        value: 'const beta = true;',
        description: 'Picker sample',
        links: [],
        obsidian_note: null,
        is_pinned: false,
        pinned_sort_order: 0,
        created_at: now(),
        updated_at: now(),
      },
    ]);
    storeSet('__seq.shortcuts', 10);

    storeSet('note_folders', [
      { id: 1, name: 'Inbox', sort_order: 0, parent_id: null },
      { id: 2, name: 'Projects', sort_order: 1, parent_id: null },
      { id: 3, name: 'Keyboard Helper', sort_order: 0, parent_id: 2 },
    ]);
    storeSet('__seq.note_folders', 3);
    storeSet('notes', [
      { id: 1, uuid: uuid(), folder_id: 1, title: 'Shopping list', content: '- milk\n- bread', is_pinned: false, pinned_sort_order: 0, created_at: now(), updated_at: now() },
      { id: 2, uuid: uuid(), folder_id: 3, title: 'OTA plan', content: '# Plan\n1. design\n2. build', is_pinned: true, pinned_sort_order: 0, created_at: now(), updated_at: now() },
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
    storeSet('admin_me', {
      user_id: 'mock-admin-user',
      name: 'Mock Admin',
      is_admin: false,
      media_quota_bytes: 1073741824,
      media_max_upload_bytes: 20971520,
      media_used_bytes: 12 * 1024 * 1024,
    });
    storeSet('admin_users', [
      {
        user_id: 'mock-admin-user',
        name: 'Mock Admin',
        created_at: now(),
        last_seen_at: now(),
        is_admin: true,
        media_quota_bytes: 1073741824,
        media_max_upload_bytes: 20971520,
        media_used_bytes: 12 * 1024 * 1024,
      },
      {
        user_id: 'mock-phone-user',
        name: 'Phone',
        created_at: now(),
        last_seen_at: null,
        is_admin: false,
        media_quota_bytes: 1073741824,
        media_max_upload_bytes: 20971520,
        media_used_bytes: 0,
      },
    ]);

    storeSet('task_categories', [
      { id: 1, name: 'Work', color: '#3b82f6', sort_order: 0, created_at: now(), updated_at: now() },
      { id: 2, name: 'Personal', color: '#10b981', sort_order: 1, created_at: now(), updated_at: now() },
    ]);
    storeSet('__seq.task_categories', 2);
    storeSet('task_statuses', [
      { id: 1, name: 'Todo', color: '#f59e0b', sort_order: 0, created_at: now(), updated_at: now() },
      { id: 2, name: 'Done', color: '#10b981', sort_order: 1, created_at: now(), updated_at: now() },
    ]);
    storeSet('__seq.task_statuses', 2);
    storeSet('tasks', [
      {
        id: 1, uuid: uuid(), title: 'Pinned mock task', category_id: 1, status_id: 1,
        is_pinned: true, bg_color: null, tracker_url: null, notes_md: '',
        sort_order: 0, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
      {
        id: 2, uuid: uuid(), title: 'Regular mock task', category_id: 2, status_id: 1,
        is_pinned: false, bg_color: null, tracker_url: null, notes_md: '',
        sort_order: 1, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
      {
        id: 3, uuid: uuid(), title: 'Pinned personal task', category_id: 2, status_id: 1,
        is_pinned: true, bg_color: null, tracker_url: null, notes_md: 'Outside Work filter',
        sort_order: 2, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
    ]);
    storeSet('__seq.tasks', 3);
    storeSet('task_checkboxes', [
      {
        id: 1, uuid: uuid(), task_id: 2, parent_id: null, text: 'Regular todo visible', is_checked: false,
        sort_order: 0, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
      {
        id: 2, uuid: uuid(), task_id: 2, parent_id: null, text: 'Regular done hidden', is_checked: true,
        sort_order: 1, created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
    ]);
    storeSet('__seq.task_checkboxes', 2);
    storeSet('task_links', [
      {
        id: 1, uuid: uuid(), task_id: 2, url: 'https://example.com/regular-a',
        label: 'Regular link A', sort_order: 0,
        created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
      {
        id: 2, uuid: uuid(), task_id: 2, url: 'https://example.com/regular-b',
        label: 'Regular link B', sort_order: 1,
        created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
      {
        id: 3, uuid: uuid(), task_id: 1, url: 'https://example.com/pinned',
        label: 'Pinned link', sort_order: 0,
        created_at: now(), updated_at: now(), sync_status: 'synced', user_id: 'mock-user',
      },
    ]);
    storeSet('__seq.task_links', 3);

    storeSet('finance_plans', [
      {
        id: 1,
        uuid: uuid(),
        name: 'Regular payments',
        currency: 'RUB',
        kind: 'monthly',
        sort_order: 0,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
      {
        id: 2,
        uuid: uuid(),
        name: 'Project expenses',
        currency: 'RUB',
        kind: 'project',
        sort_order: 1,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
    ]);
    storeSet('__seq.finance_plans', 2);
    storeSet('finance_items', [
      {
        id: 1,
        uuid: uuid(),
        plan_id: 1,
        parent_id: null,
        name: 'Housing',
        amount_cents: 0,
        due_day: null,
        due_date: null,
        note: '',
        sort_order: 0,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
      {
        id: 2,
        uuid: uuid(),
        plan_id: 1,
        parent_id: 1,
        name: 'Rent',
        amount_cents: 12000000,
        due_day: 21,
        due_date: null,
        note: 'Monthly',
        sort_order: 0,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
      {
        id: 3,
        uuid: uuid(),
        plan_id: 1,
        parent_id: 1,
        name: 'Internet',
        amount_cents: 70000,
        due_day: 3,
        due_date: null,
        note: '',
        sort_order: 1,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
      {
        id: 4,
        uuid: uuid(),
        plan_id: 1,
        parent_id: null,
        name: 'Subscriptions',
        amount_cents: 0,
        due_day: null,
        due_date: null,
        note: '',
        sort_order: 1,
        created_at: now(),
        updated_at: now(),
        sync_status: 'pending',
        user_id: 'mock-user',
      },
    ]);
    storeSet('__seq.finance_items', 4);
    storeSet('finance_payments', []);
    storeSet('__seq.finance_payments', 0);

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

  function recordMockCall(command, payload = {}) {
    window.__mockCallSeq = (window.__mockCallSeq || 0) + 1;
    if (!Array.isArray(window.__mockCommandLog)) window.__mockCommandLog = [];
    const entry = { seq: window.__mockCallSeq, command, payload };
    window.__mockCommandLog.push(entry);
    return entry;
  }

  const shareLinks = new Map();
  const telegraphPages = new Map();
  const mediaJobs = new Map();
  const mediaAssets = new Map();

  function shareKey(itemType, itemUuid) {
    return `${itemType}:${itemUuid}`;
  }

  function mockShareLink(itemType, itemUuid) {
    const token = `mock-${itemType}-${itemUuid}`;
    const stamp = now();
    return {
      token,
      public_url: `https://ister-app.ru/share/${token}`,
      item_type: itemType,
      item_uuid: itemUuid,
      is_active: true,
      created_at: stamp,
      updated_at: stamp,
      revoked_at: null,
    };
  }

  function mockTelegraphPage(itemType, itemUuid, existing = null) {
    const stamp = now();
    const slug = `${itemType}-${itemUuid}`.replace(/[^A-Za-z0-9_-]/g, '-');
    return {
      item_type: itemType,
      item_uuid: itemUuid,
      url: existing?.url || `https://telegra.ph/${slug}-06-09`,
      path: existing?.path || `${slug}-06-09`,
      title: existing?.title || (itemType === 'note' ? 'Mock note' : 'Mock snippet'),
      content_hash: Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64),
      views: (existing?.views || 0) + 1,
      created_at: existing?.created_at || stamp,
      updated_at: stamp,
      published_at: stamp,
    };
  }

  function mockMediaJob({ sourcePath, assetName = 'mock-image', tokenPrefix = 'mock' }) {
    const jobId = 'mock-media-job-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    const assetUuid = 'mock-media-asset-' + Math.random().toString(16).slice(2);
    const failPreviews = !!window.__mockFailMediaPreviews;
    const remotePreviews = !!window.__mockRemoteMediaPreviews;
    mediaAssets.set(assetUuid, { assetName, tokenPrefix });
    mediaJobs.set(jobId, {
      job_id: jobId,
      status: 'ready',
      progress_current: 4,
      progress_total: 4,
      asset_uuid: assetUuid,
      variants: ['small', 'balanced', 'readable', 'original'].map((variant, index) => {
        const publicToken = `${tokenPrefix}-${variant}`;
        return {
          variant,
          public_token: publicToken,
          preview_url: failPreviews
            ? `data:image/webp;variant=${publicToken};base64,bm90LWEtd2VicA==`
            : remotePreviews
              ? `https://ister-app.ru/snippets-media/${publicToken}.webp`
            : 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#161b22"/><text x="40" y="190" fill="#58a6ff" font-size="42">${variant}</text></svg>`),
          mime_type: 'image/webp',
          size_bytes: (index + 1) * 10240,
          width: 640,
          height: 360,
          sha256: 'x'.repeat(64),
        };
      }),
      source_path: sourcePath,
    });
    window.dispatchEvent(new CustomEvent('media-upload-progress', {
      detail: { phase: 'upload', bytes_done: 100, bytes_total: 100, finished: true },
    }));
    return { job_id: jobId, status: 'queued' };
  }

  // ----- whisper mocks -----
  const whisperMockState = {
    installedModels: [],
    history: [],
    currentState: 'idle',
    levelTimer: null,
    liveState: 'idle',
    liveTimers: [],
    liveCommittedText: '',
    liveModel: 'nova-3',
    liveProvider: 'deepgram',
    recordingProvider: 'local',
    recordingModel: 'ggml-small',
  };

  const whisperCatalog = [
    { name: 'ggml-tiny',          display_name: 'tiny',                 size_bytes: 77691712,   sha256: 'x', download_url: '', ru_quality: 1, recommended: false, notes: 'Fast but poor for Russian' },
    { name: 'ggml-base',          display_name: 'base',                 size_bytes: 147951616,  sha256: 'x', download_url: '', ru_quality: 2, recommended: false, notes: 'Weak for Russian' },
    { name: 'ggml-small',         display_name: 'small (multilingual)', size_bytes: 487601967,  sha256: 'x', download_url: '', ru_quality: 4, recommended: true,  notes: 'Best tradeoff for RU+EN' },
    { name: 'ggml-medium',        display_name: 'medium',               size_bytes: 1533763059, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Top quality if RAM allows' },
    { name: 'ggml-large-v3',      display_name: 'large-v3',             size_bytes: 3095018317, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Best quality, GPU recommended' },
    { name: 'ggml-large-v3-q5_0', display_name: 'large-v3 (Q5)',        size_bytes: 1080000000, sha256: 'x', download_url: '', ru_quality: 5, recommended: false, notes: 'Quantized: large-quality at ~1GB' },
  ];

  function clearWhisperLiveTimers() {
    for (const timer of whisperMockState.liveTimers) clearTimeout(timer);
    whisperMockState.liveTimers = [];
    if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
    whisperMockState.levelTimer = null;
  }

  function dispatchWhisperLiveState(state, model = whisperMockState.liveModel) {
    whisperMockState.liveState = state;
    window.dispatchEvent(new CustomEvent('whisper:live-state-changed', {
      detail: { state, model: state === 'idle' ? null : model, provider: whisperMockState.liveProvider },
    }));
  }

  function dispatchWhisperLiveFinal(text) {
    whisperMockState.liveCommittedText = text;
    window.dispatchEvent(new CustomEvent('whisper:live-final', {
      detail: { chunk: text, committed_text: text, speech_final: true, provider: whisperMockState.liveProvider },
    }));
  }

  function clickhouseMockPages() {
    const updated = '2026-06-20T10:00:00.000Z';
    return [
      {
        id: 1,
        category: 'Functions / Arrays',
        title: 'Array Functions',
        source_url: 'mock://clickhouse/array-functions.md',
        public_url: 'https://clickhouse.com/docs/ru/sql-reference/functions/array-functions',
        updated_at: updated,
        markdown: '# Array Functions\n\n## array\n\nCreates an array.\n\n```sql\narray(x1 [, x2])\n```\n\n## arrayCompact\n\nRemoves consecutive duplicate elements.\n\n```sql\narrayCompact(arr)\n```\n\n## arrayConcat\n\nCombines arrays.\n\n```sql\narrayConcat(arr1 [, arr2])\n```',
        sections: [
          {
            id: 1,
            page_id: 1,
            category: 'Functions / Arrays',
            page_title: 'Array Functions',
            title: 'array',
            slug: 'array',
            section_path: 'array',
            level: 2,
            body: 'Creates an array.\n\n```sql\narray(x1 [, x2])\n```',
            normalized_search_text: 'array array functions functions arrays creates an array sql array x1 x2',
            content_hash: 'mock-array',
          },
          {
            id: 2,
            page_id: 1,
            category: 'Functions / Arrays',
            page_title: 'Array Functions',
            title: 'arrayCompact',
            slug: 'arraycompact',
            section_path: 'arraycompact',
            level: 2,
            body: 'Removes consecutive duplicate elements.\n\n```sql\narrayCompact(arr)\n```',
            normalized_search_text: 'array compact array functions functions arrays removes consecutive duplicate elements sql array compact arr',
            content_hash: 'mock-arraycompact',
          },
          {
            id: 3,
            page_id: 1,
            category: 'Functions / Arrays',
            page_title: 'Array Functions',
            title: 'arrayConcat',
            slug: 'arrayconcat',
            section_path: 'arrayconcat',
            level: 2,
            body: 'Combines arrays.\n\n```sql\narrayConcat(arr1 [, arr2])\n```',
            normalized_search_text: 'array concat array functions functions arrays combines arrays sql array concat arr1 arr2',
            content_hash: 'mock-arrayconcat',
          },
        ],
      },
      {
        id: 2,
        category: 'Reference / Statements',
        title: 'SELECT',
        source_url: 'mock://clickhouse/select.md',
        public_url: 'https://clickhouse.com/docs/ru/sql-reference/statements/select',
        updated_at: updated,
        markdown: '# SELECT\n\n## SELECT query\n\nSELECT retrieves data from one or more tables.',
        sections: [
          {
            id: 4,
            page_id: 2,
            category: 'Reference / Statements',
            page_title: 'SELECT',
            title: 'SELECT query',
            slug: 'select-query',
            section_path: 'select-query',
            level: 2,
            body: 'SELECT retrieves data from one or more tables.',
            normalized_search_text: 'select query reference statements select retrieves data from one or more tables',
            content_hash: 'mock-select',
          },
        ],
      },
    ];
  }

  function normalizeClickhouseQuery(text) {
    return String(text || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function clickhouseExcerpt(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  }

  function clickhouseSectionSummary(section) {
    return {
      ...section,
      excerpt: clickhouseExcerpt(section.body),
      body: '',
      normalized_search_text: '',
    };
  }

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
    async get_admin_me() { return storeGet('admin_me', null); },
    async list_admin_users() { return storeGet('admin_users', []); },
    async update_admin_user_limits({ userId, mediaQuotaBytes, mediaMaxUploadBytes }) {
      let updated = null;
      const users = storeGet('admin_users', []).map(u => {
        if (u.user_id !== userId) return u;
        updated = {
          ...u,
          media_quota_bytes: mediaQuotaBytes,
          media_max_upload_bytes: mediaMaxUploadBytes,
        };
        return updated;
      });
      storeSet('admin_users', users);
      if (!updated) throw new Error('user not found');
      return updated;
    },
    async get_ai_provider_settings() {
      return {
        deepseek_configured: !!storeGet('ai_provider_deepseek_key', ''),
        deepseek_updated_at: storeGet('ai_provider_deepseek_updated_at', null),
        telegram_bot_configured: !!storeGet('ai_provider_telegram_bot_token', ''),
        telegram_bot_updated_at: storeGet('ai_provider_telegram_bot_updated_at', null),
      };
    },
    async save_ai_provider_settings({ deepseekApiKey, deepseek_api_key }) {
      const key = String(deepseekApiKey ?? deepseek_api_key ?? '').trim();
      if (!key) throw new Error('DeepSeek API key is empty');
      const updatedAt = now();
      storeSet('ai_provider_deepseek_key', key);
      storeSet('ai_provider_deepseek_updated_at', updatedAt);
      return {
        deepseek_configured: true,
        deepseek_updated_at: updatedAt,
        telegram_bot_configured: !!storeGet('ai_provider_telegram_bot_token', ''),
        telegram_bot_updated_at: storeGet('ai_provider_telegram_bot_updated_at', null),
      };
    },
    async clear_ai_provider_settings() {
      const updatedAt = now();
      localStorage.removeItem(LS_PREFIX + 'ai_provider_deepseek_key');
      storeSet('ai_provider_deepseek_updated_at', updatedAt);
      return {
        deepseek_configured: false,
        deepseek_updated_at: updatedAt,
        telegram_bot_configured: !!storeGet('ai_provider_telegram_bot_token', ''),
        telegram_bot_updated_at: storeGet('ai_provider_telegram_bot_updated_at', null),
      };
    },
    async get_ai_provider_balance() {
      if (!storeGet('ai_provider_deepseek_key', '')) throw new Error('DeepSeek API key is not configured for this user');
      return {
        is_available: true,
        balance_infos: [
          {
            currency: 'USD',
            total_balance: '12.50',
            granted_balance: '2.50',
            topped_up_balance: '10.00',
          },
        ],
      };
    },
    async get_ai_agent_settings() {
      return {
        custom_instructions: storeGet('ai_agent_custom_instructions', ''),
        updated_at: storeGet('ai_agent_custom_instructions_updated_at', null),
        core_instructions: [
          'You are an AI controller for Snippets Helper.',
          'Never invent UUIDs.',
          'Do not request destructive actions; deletion and bulk edits are unavailable.',
        ].join('\n'),
      };
    },
    async save_ai_agent_settings({ customInstructions, custom_instructions }) {
      const custom = String(customInstructions ?? custom_instructions ?? '').trim();
      const updatedAt = now();
      storeSet('ai_agent_custom_instructions', custom);
      storeSet('ai_agent_custom_instructions_updated_at', updatedAt);
      return {
        custom_instructions: custom,
        updated_at: updatedAt,
        core_instructions: [
          'You are an AI controller for Snippets Helper.',
          'Never invent UUIDs.',
          'Do not request destructive actions; deletion and bulk edits are unavailable.',
        ].join('\n'),
      };
    },
    async get_ai_capabilities() {
      return {
        tools: [
          {
            name: 'search_tasks',
            description: 'Search user tasks by title.',
            parameters: [{ name: 'query', required: true }],
          },
          {
            name: 'open_task',
            description: 'Open one task in the desktop UI.',
            parameters: [{ name: 'query', required: false }],
          },
          {
            name: 'show_task',
            description: 'Return a readable task summary.',
            parameters: [{ name: 'query', required: false }],
          },
          {
            name: 'complete_task_checkbox',
            description: 'Mark a task checkbox completed by text query.',
            parameters: [{ name: 'task_query', required: false }, { name: 'checkbox_query', required: false }],
          },
        ],
        context_fields: [
          { name: 'module', description: 'Current app module.' },
          { name: 'current_task_uuid', description: 'Current task UUID.' },
          { name: 'recent_task_uuid', description: 'Last task used by AI.' },
          { name: 'locale', description: 'Preferred language.' },
        ],
        safety_rules: [
          'Never invent UUIDs.',
          'Do not request destructive actions; deletion and bulk edits are unavailable.',
        ],
        telegram_notes: [
          'Telegram show task replies with task details instead of navigating UI.',
        ],
      };
    },
    async preview_ai_prompt({ request }) {
      const message = String(request?.message || '');
      recordMockCall('preview_ai_prompt', { mode: request?.mode || 'command', message });
      const lower = message.toLowerCase();
      const command = lower.includes('покажи') || lower.includes('show')
        ? { name: 'show_task', args: { query: 'Аптека' } }
        : { name: 'create_task', args: { title: 'Preview task' } };
      return {
        mode: request?.mode || 'command',
        reply: 'Preview plan only.',
        commands: [command],
        results: [],
      };
    },
    async save_ai_telegram_bot_settings({ telegramBotToken, telegram_bot_token }) {
      const token = String(telegramBotToken ?? telegram_bot_token ?? '').trim();
      if (!token) throw new Error('Telegram bot token is empty');
      const updatedAt = now();
      storeSet('ai_provider_telegram_bot_token', token);
      storeSet('ai_provider_telegram_bot_updated_at', updatedAt);
      return {
        deepseek_configured: !!storeGet('ai_provider_deepseek_key', ''),
        deepseek_updated_at: storeGet('ai_provider_deepseek_updated_at', null),
        telegram_bot_configured: true,
        telegram_bot_updated_at: updatedAt,
      };
    },
    async clear_ai_telegram_bot_settings() {
      const updatedAt = now();
      localStorage.removeItem(LS_PREFIX + 'ai_provider_telegram_bot_token');
      storeSet('ai_provider_telegram_bot_updated_at', updatedAt);
      storeSet('telegram_bound_chats', []);
      return {
        deepseek_configured: !!storeGet('ai_provider_deepseek_key', ''),
        deepseek_updated_at: storeGet('ai_provider_deepseek_updated_at', null),
        telegram_bot_configured: false,
        telegram_bot_updated_at: updatedAt,
      };
    },
    async get_ai_telegram_status() {
      return {
        configured: !!storeGet('ai_provider_telegram_bot_token', ''),
        polling_enabled: true,
        last_update_id: storeGet('telegram_last_update_id', null),
        last_error: null,
        pairing_code: 'mock-pair-123',
        pairing_command: '/start mock-pair-123',
        bound_chats: storeGet('telegram_bound_chats', []),
      };
    },
    async poll_ai_telegram_once() {
      if (!storeGet('ai_provider_telegram_bot_token', '')) {
        throw new Error('Telegram bot token is not configured for this user');
      }
      const updatedAt = now();
      const chats = storeGet('telegram_bound_chats', []);
      if (!chats.some((chat) => String(chat.chat_id) === '123456789')) {
        chats.push({
          chat_id: 123456789,
          created_at: updatedAt,
          updated_at: updatedAt,
          is_active: true,
        });
      }
      storeSet('telegram_bound_chats', chats);
      storeSet('telegram_last_update_id', 1001);
      return {
        updates: 1,
        next_offset: 1002,
        results: [{ status: 'bound', chat_id: 123456789 }],
      };
    },
    async unbind_ai_telegram_chat({ chatId, chat_id }) {
      const id = Number(chatId ?? chat_id);
      const chats = storeGet('telegram_bound_chats', [])
        .filter((chat) => Number(chat.chat_id) !== id);
      storeSet('telegram_bound_chats', chats);
      return { status: 'ok', chat_id: id };
    },
    async ai_chat({ request }) {
      const mode = request?.mode === 'chat' ? 'chat' : 'command';
      const message = String(request?.message || '');
      recordMockCall('ai_chat', { mode, message });
      if (mode === 'chat') {
        return {
          mode,
          reply: `Mock AI answer: ${message}`,
          commands: [],
          results: [],
        };
      }
      const tasks = storeGet('tasks', []).filter(t => t.sync_status !== 'deleted');
      const regular = tasks.find(t => /regular/i.test(t.title)) || tasks[0] || null;
      const commands = [];
      const lower = message.toLowerCase();
      if (lower.includes('regular todo') && lower.includes('previous command results')) {
        commands.push({
          name: 'complete_task_checkbox',
          args: { task_ref: 'current', checkbox_query: 'Regular todo' },
        });
      } else if (lower.includes('regular todo') && (lower.includes('отмет') || lower.includes('complete'))) {
        commands.push({
          name: 'search_tasks',
          args: { query: 'Regular' },
        });
      } else if (lower.includes('create')) {
        commands.push({
          name: 'create_task',
          args: { title: 'AI created mock task', checkboxes: ['First AI checkbox'] },
        });
      } else if (lower.includes('add') && regular) {
        commands.push({
          name: 'add_task_checkbox',
          args: { task_uuid: regular.uuid, text: 'AI added checkbox' },
        });
      } else if (regular) {
        commands.push({
          name: 'open_task',
          args: { task_uuid: regular.uuid },
        });
      }
      return {
        mode,
        reply: commands.length ? 'Mock AI command plan is ready.' : 'Mock AI did not find a command.',
        commands,
        results: [],
      };
    },

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
      return createItem('shortcuts', {
        uuid: uuid(),
        ...args,
        obsidian_note: args.obsidian_note ?? null,
        is_pinned: false,
        pinned_sort_order: 0,
      });
    },
    async update_shortcut({ id, ...patch }) { return updateItem('shortcuts', id, patch); },
    async set_shortcut_pinned({ id, isPinned }) {
      const shortcuts = storeGet('shortcuts', []);
      const targetId = Number(id);
      const isPinnedBool = !!isPinned;
      const maxOrder = shortcuts
        .filter(s => s.is_pinned && Number(s.id) !== targetId)
        .reduce((max, s) => Math.max(max, Number(s.pinned_sort_order) || 0), -1);
      const next = shortcuts.map(s => Number(s.id) === targetId
        ? {
            ...s,
            is_pinned: isPinnedBool,
            pinned_sort_order: isPinnedBool ? maxOrder + 1 : 0,
            updated_at: now(),
          }
        : s);
      storeSet('shortcuts', next);
    },
    async reorder_pinned_shortcuts({ ids }) {
      const order = new Map((ids || []).map((id, index) => [Number(id), index]));
      const shortcuts = storeGet('shortcuts', []).map(s => (
        order.has(Number(s.id)) && s.is_pinned
          ? { ...s, pinned_sort_order: order.get(Number(s.id)), updated_at: now() }
          : s
      ));
      storeSet('shortcuts', shortcuts);
    },
    async delete_shortcut({ id }) { deleteItem('shortcuts', id); },
    async list_snippet_tags() {
      return [...storeGet('snippet_tags', [])].sort((a, b) => (
        (Number(a.sort_order ?? a.sortOrder) || 0) - (Number(b.sort_order ?? b.sortOrder) || 0)
        || String(a.name || '').localeCompare(String(b.name || ''))
      ));
    },
    async create_snippet_tag(args) {
      const { sortOrder, ...rest } = args;
      return createItem('snippet_tags', { uuid: uuid(), ...rest, sort_order: Number(sortOrder) || 0 });
    },
    async update_snippet_tag({ id, sortOrder, ...patch }) {
      return updateItem('snippet_tags', id, { ...patch, sort_order: Number(sortOrder) || 0 });
    },
    async delete_snippet_tag({ id }) { deleteItem('snippet_tags', id); },
    async open_link_window({ url }) { console.log('[mock] open_link_window', url); window.open(url, '_blank'); },
    async open_module_window({ moduleId }) {
      window.__mockOpenedModuleWindows = window.__mockOpenedModuleWindows || [];
      window.__mockOpenedModuleWindows.push(moduleId);
    },
    async open_module_object_window(args) {
      window.__mockOpenedModuleObjectWindows = window.__mockOpenedModuleObjectWindows || [];
      window.__mockOpenedModuleObjectWindows.push({ ...args });
    },
    async open_launchpad() {
      window.__mockLaunchpadOpened = true;
    },
    async close_launchpad() {
      window.__mockLaunchpadClosed = true;
    },
    async resize_launchpad_window({ columns, rows }) {
      window.__mockLaunchpadResizeCalls = window.__mockLaunchpadResizeCalls || [];
      window.__mockLaunchpadResizeCalls.push({ columns, rows });
    },
    async open_snippet_micro_picker() {
      window.__mockSnippetMicroPickerOpened = true;
    },
    async close_snippet_micro_picker() {
      window.__mockSnippetMicroPickerClosed = true;
    },
    async insert_snippet_micro_picker_text({ text }) {
      window.__mockClipboardText = text;
      try { await navigator.clipboard.writeText(text); } catch {}
      return { method: 'copy', message: 'Mock snippet copied to clipboard.' };
    },

    // ── Obsidian ────────────────────────────────────────
    async list_obsidian_vaults() { return []; },
    async list_obsidian_folders() { return []; },
    async list_obsidian_files() { return []; },
    async create_obsidian_note() { throw new Error('Obsidian not configured in mock'); },
    async read_obsidian_note() { return '# Mock note\n\n```bash\necho note\n```'; },
    async link_obsidian_note({ snippetId, notePath }) {
      return updateItem('shortcuts', snippetId, { obsidian_note: notePath || null });
    },

    // ── Clipboard / URL ─────────────────────────────────
    async copy_to_clipboard({ text }) {
      window.__mockClipboardText = text;
      navigator.clipboard.writeText(text).catch(() => {});
    },
    async read_clipboard() { try { return await navigator.clipboard.readText(); } catch { return ''; } },
    async open_url({ url }) {
      window.__mockOpenedUrls = window.__mockOpenedUrls || [];
      window.__mockOpenedUrls.push(url);
      window.open(url, '_blank');
    },

    // ── Share links ─────────────────────────────────────
    async get_share_link({ itemType, itemUuid }) {
      return shareLinks.get(shareKey(itemType, itemUuid)) || null;
    },
    async create_share_link({ itemType, itemUuid }) {
      recordMockCall('create_share_link', { itemType, itemUuid });
      const key = shareKey(itemType, itemUuid);
      if (!shareLinks.has(key)) {
        shareLinks.set(key, mockShareLink(itemType, itemUuid));
      }
      return shareLinks.get(key);
    },
    async revoke_share_link({ token }) {
      for (const [key, value] of shareLinks.entries()) {
        if (value.token === token) shareLinks.delete(key);
      }
      return null;
    },
    async get_telegraph_page({ itemType, itemUuid }) {
      return telegraphPages.get(shareKey(itemType, itemUuid)) || null;
    },
    async publish_telegraph_page({ itemType, itemUuid }) {
      recordMockCall('publish_telegraph_page', { itemType, itemUuid });
      if (window.__mockFailTelegraphPublish) {
        throw new Error('HTTP 502 Bad Gateway: {"detail":"Telegraph publish failed: Telegra.ph API timeout"}');
      }
      const key = shareKey(itemType, itemUuid);
      const page = mockTelegraphPage(itemType, itemUuid, telegraphPages.get(key));
      telegraphPages.set(key, page);
      return page;
    },

    // ── Media uploads ───────────────────────────────────
    async pick_media_file() {
      return '/tmp/mock-image.png';
    },
    async pick_html_file() {
      return '/tmp/mock-presentation.html';
    },
    async start_media_upload({ filePath }) {
      return mockMediaJob({ sourcePath: filePath });
    },
    async start_html_upload({ filePath }) {
      const assetUuid = 'mock-html-asset-' + Math.random().toString(16).slice(2);
      const token = 'mock_HTML_token_123456';
      window.dispatchEvent(new CustomEvent('media-upload-progress', {
        detail: { phase: 'upload', bytes_done: 1200, bytes_total: 1200, finished: true },
      }));
      return {
        asset_uuid: assetUuid,
        markdown: `![html:mock-presentation](https://ister-app.ru/snippets-api/v1/media/html/${token})`,
        url: `https://ister-app.ru/snippets-api/v1/media/html/${token}`,
        title: 'mock-presentation',
        size_bytes: 1200,
        source_path: filePath,
      };
    },
    async start_media_clipboard_upload() {
      return mockMediaJob({
        sourcePath: 'clipboard',
        assetName: 'clipboard-screenshot',
        tokenPrefix: 'mock-clipboard',
      });
    },
    async cancel_media_upload() {
      return true;
    },
    async get_media_job({ jobId }) {
      return mediaJobs.get(jobId) || { job_id: jobId, status: 'failed', error: 'mock job not found' };
    },
    async get_media_preview_data_url({ previewUrl }) {
      window.__mockMediaPreviewDataCalls = (window.__mockMediaPreviewDataCalls || 0) + 1;
      const label = String(previewUrl || '').split('/').pop() || 'preview.webp';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#161b22"/><text x="40" y="190" fill="#7ee787" font-size="32">${label}</text></svg>`;
      const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      return { data_url: dataUrl, mime_type: 'image/svg+xml', size_bytes: svg.length };
    },
    async delete_media_asset() {
      return null;
    },
    async select_media_variant({ assetUuid, variant }) {
      const asset = mediaAssets.get(assetUuid) || { assetName: 'mock-image', tokenPrefix: 'mock' };
      return {
        asset_uuid: assetUuid,
        variant,
        markdown: `![${asset.assetName}](https://ister-app.ru/snippets-media/${asset.tokenPrefix}-${variant}.webp)`,
        url: `https://ister-app.ru/snippets-media/${asset.tokenPrefix}-${variant}.webp`,
        width: 640,
        height: 360,
        size_bytes: 10240,
      };
    },

    // ── Sync / Update ───────────────────────────────────
    async trigger_sync() {
      const entry = recordMockCall('trigger_sync');
      window.__mockLastSyncCall = entry.seq;
      if (typeof window.__mockTriggerSync === 'function') {
        return await window.__mockTriggerSync();
      }
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
    async clear_frontend_browsing_data() {
      const count = Number(localStorage.getItem('mock.clear_frontend_browsing_data_calls') || '0');
      localStorage.setItem('mock.clear_frontend_browsing_data_calls', String(count + 1));
      return [];
    },
    async revert_frontend() { return '0.9.5-f0'; },
    async drop_frontend_override() { return; },
    async confirm_frontend_boot() { return; },
    async debug_sync() { return { tables: {} }; },
    async force_full_sync() { return { reset: true, pull: { total: 0 } }; },

    // ── Notes ───────────────────────────────────────────
    async list_note_folders() {
      return [...storeGet('note_folders', [])].sort((a, b) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
        || String(a.name || '').localeCompare(String(b.name || ''))
        || Number(a.id) - Number(b.id)
      );
    },
    async create_note_folder({ name, sortOrder, parentId }) {
      return createItem('note_folders', {
        name,
        sort_order: Number(sortOrder) || 0,
        parent_id: parentId == null ? null : Number(parentId),
        uuid: uuid(),
      });
    },
    async update_note_folder({ id, name, sortOrder, parentId }) {
      return updateItem('note_folders', id, {
        name,
        sort_order: Number(sortOrder) || 0,
        parent_id: parentId == null ? null : Number(parentId),
      });
    },
    async move_note_folder({ id, parentId, beforeId }) {
      const folders = storeGet('note_folders', []);
      const sourceId = Number(id);
      const newParentId = parentId == null ? null : Number(parentId);
      const targetBeforeId = beforeId == null ? null : Number(beforeId);
      const source = folders.find(f => Number(f.id) === sourceId);
      if (!source) throw new Error('folder not found');
      if (newParentId === sourceId || targetBeforeId === sourceId) {
        throw new Error('folder cannot be moved into or before itself');
      }
      if (newParentId != null && !folders.some(f => Number(f.id) === newParentId)) {
        throw new Error('target parent folder not found');
      }
      let current = newParentId;
      while (current != null) {
        if (Number(current) === sourceId) {
          throw new Error('folder cannot be moved into its descendant');
        }
        const parent = folders.find(f => Number(f.id) === Number(current));
        current = parent ? parent.parent_id : null;
      }
      if (targetBeforeId != null) {
        const before = folders.find(f => Number(f.id) === targetBeforeId);
        if (!before || (before.parent_id ?? null) !== newParentId) {
          throw new Error('before folder must belong to the target parent');
        }
      }
      const oldParentId = source.parent_id ?? null;
      const normalizeBucket = (bucketParentId, forcedOrder = null) => {
        const bucket = forcedOrder || folders
          .filter(f => Number(f.id) !== sourceId && (f.parent_id ?? null) === bucketParentId)
          .sort((a, b) =>
            (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
            || String(a.name || '').localeCompare(String(b.name || ''))
            || Number(a.id) - Number(b.id)
          )
          .map(f => Number(f.id));
        bucket.forEach((folderId, index) => {
          const folder = folders.find(f => Number(f.id) === folderId);
          if (!folder) return;
          folder.parent_id = bucketParentId;
          folder.sort_order = index;
          folder.updated_at = now();
        });
      };
      if (oldParentId !== newParentId) normalizeBucket(oldParentId);
      const newBucket = folders
        .filter(f => Number(f.id) !== sourceId && (f.parent_id ?? null) === newParentId)
        .sort((a, b) =>
          (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
          || String(a.name || '').localeCompare(String(b.name || ''))
          || Number(a.id) - Number(b.id)
        )
        .map(f => Number(f.id));
      const insertAt = targetBeforeId == null ? newBucket.length : Math.max(0, newBucket.indexOf(targetBeforeId));
      newBucket.splice(insertAt, 0, sourceId);
      normalizeBucket(newParentId, newBucket);
      storeSet('note_folders', folders);
    },
    async delete_note_folder({ id }) {
      deleteItem('note_folders', id);
      const notes = storeGet('notes', []).filter(n => n.folder_id !== id);
      storeSet('notes', notes);
    },
    async list_notes({ folderId }) {
      return storeGet('notes', [])
        .filter(n => folderId == null || n.folder_id === folderId)
        .sort((a, b) =>
          Number(b.is_pinned) - Number(a.is_pinned)
          || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
        );
    },
    async create_note({ folderId, title, content }) {
      const item = createItem('notes', {
        uuid: uuid(),
        folder_id: folderId,
        title,
        content: content || '',
        is_pinned: false,
        pinned_sort_order: 0,
      });
      const entry = recordMockCall('create_note', { id: item.id, uuid: item.uuid, title, content: content || '' });
      window.__mockLastNoteWriteCall = entry.seq;
      return item;
    },
    async update_note({ id, isPinned, ...patch }) {
      const notes = storeGet('notes', []);
      const targetId = Number(id);
      const current = notes.find(n => Number(n.id) === targetId);
      const nextPinned = isPinned !== undefined ? !!isPinned : !!current?.is_pinned;
      const maxOrder = notes
        .filter(n => n.is_pinned && Number(n.id) !== targetId)
        .reduce((max, n) => Math.max(max, Number(n.pinned_sort_order) || 0), -1);
      const item = updateItem('notes', id, {
        ...patch,
        is_pinned: nextPinned,
        pinned_sort_order: nextPinned
          ? (current?.is_pinned ? (Number(current.pinned_sort_order) || 0) : maxOrder + 1)
          : 0,
      });
      const entry = recordMockCall('update_note', { id: item.id, uuid: item.uuid, title: item.title, content: item.content || '' });
      window.__mockLastNoteWriteCall = entry.seq;
      return item;
    },
    async reorder_pinned_notes({ ids }) {
      const order = new Map((ids || []).map((id, index) => [Number(id), index]));
      const notes = storeGet('notes', []).map(n => (
        order.has(Number(n.id)) && n.is_pinned
          ? { ...n, pinned_sort_order: order.get(Number(n.id)), updated_at: now() }
          : n
      ));
      storeSet('notes', notes);
    },
    async delete_note({ id }) { deleteItem('notes', id); },

    // ── Finance ─────────────────────────────────────────
    async list_finance_plans() {
      return [...storeGet('finance_plans', [])]
        .filter(p => p.sync_status !== 'deleted')
        .sort((a, b) =>
          (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
          || String(a.name || '').localeCompare(String(b.name || ''))
          || Number(a.id) - Number(b.id)
        );
    },
    async create_finance_plan({ name, currency, kind }) {
      const sortOrder = storeGet('finance_plans', [])
        .filter(p => p.sync_status !== 'deleted')
        .reduce((max, p) => Math.max(max, Number(p.sort_order) || 0), -1) + 1;
      return createItem('finance_plans', {
        uuid: uuid(),
        name: name || 'New list',
        currency: currency || 'RUB',
        kind: kind || 'monthly',
        sort_order: sortOrder,
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },
    async update_finance_plan({ id, name, currency, kind }) {
      return updateItem('finance_plans', Number(id), {
        name: name || 'Untitled list',
        currency: currency || 'RUB',
        kind: kind || 'monthly',
        sync_status: 'pending',
      });
    },
    async reorder_finance_plans({ ids }) {
      const order = new Map((ids || []).map((id, index) => [Number(id), index]));
      const plans = storeGet('finance_plans', []).map(plan => (
        order.has(Number(plan.id)) && plan.sync_status !== 'deleted'
          ? { ...plan, sort_order: order.get(Number(plan.id)), updated_at: now(), sync_status: 'pending' }
          : plan
      ));
      storeSet('finance_plans', plans);
    },
    async delete_finance_plan({ id }) {
      const planId = Number(id);
      storeSet('finance_plans', storeGet('finance_plans', []).map(plan => (
        Number(plan.id) === planId
          ? { ...plan, sync_status: 'deleted', updated_at: now() }
          : plan
      )));
      storeSet('finance_items', storeGet('finance_items', []).map(item => (
        Number(item.plan_id) === planId
          ? { ...item, sync_status: 'deleted', updated_at: now() }
          : item
      )));
      storeSet('finance_payments', storeGet('finance_payments', []).map(payment => (
        Number(payment.plan_id) === planId
          ? { ...payment, sync_status: 'deleted', updated_at: now() }
          : payment
      )));
    },
    async list_finance_items({ planId, plan_id }) {
      const targetPlanId = Number(planId ?? plan_id);
      return [...storeGet('finance_items', [])]
        .filter(item => Number(item.plan_id) === targetPlanId && item.sync_status !== 'deleted')
        .sort((a, b) =>
          String(a.parent_id ?? '').localeCompare(String(b.parent_id ?? ''))
          || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
          || String(a.name || '').localeCompare(String(b.name || ''))
          || Number(a.id) - Number(b.id)
        );
    },
    async create_finance_item({
      planId,
      plan_id,
      parentId,
      parent_id,
      name,
      amountCents,
      amount_cents,
      dueDay,
      due_day,
      dueDate,
      due_date,
      note,
    }) {
      const targetPlanId = Number(planId ?? plan_id);
      const targetParentId = parentId ?? parent_id ?? null;
      const normalizedParentId = targetParentId == null ? null : Number(targetParentId);
      const siblings = storeGet('finance_items', [])
        .filter(item =>
          Number(item.plan_id) === targetPlanId
          && (item.parent_id ?? null) === normalizedParentId
          && item.sync_status !== 'deleted'
        );
      const sortOrder = siblings.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), -1) + 1;
      const amount = Number(amountCents ?? amount_cents ?? 0);
      if (amount < 0) throw new Error('amount_cents must be non-negative');
      const dayValue = dueDay ?? due_day ?? null;
      const normalizedDay = dayValue == null || dayValue === '' ? null : Number(dayValue);
      if (normalizedDay != null && (!Number.isInteger(normalizedDay) || normalizedDay < 1 || normalizedDay > 31)) {
        throw new Error('due_day must be between 1 and 31');
      }
      const normalizedDate = String(dueDate ?? due_date ?? '').trim() || null;
      if (normalizedDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        throw new Error('due_date must be a valid YYYY-MM-DD date');
      }
      return createItem('finance_items', {
        uuid: uuid(),
        plan_id: targetPlanId,
        parent_id: normalizedParentId,
        name: name || 'New item',
        amount_cents: amount,
        due_day: normalizedDay,
        due_date: normalizedDate,
        note: note || '',
        sort_order: sortOrder,
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },
    async update_finance_item({
      id,
      name,
      amountCents,
      amount_cents,
      dueDay,
      due_day,
      dueDate,
      due_date,
      note,
    }) {
      const amount = Number(amountCents ?? amount_cents ?? 0);
      if (amount < 0) throw new Error('amount_cents must be non-negative');
      const dayValue = dueDay ?? due_day ?? null;
      const normalizedDay = dayValue == null || dayValue === '' ? null : Number(dayValue);
      if (normalizedDay != null && (!Number.isInteger(normalizedDay) || normalizedDay < 1 || normalizedDay > 31)) {
        throw new Error('due_day must be between 1 and 31');
      }
      const normalizedDate = String(dueDate ?? due_date ?? '').trim() || null;
      if (normalizedDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        throw new Error('due_date must be a valid YYYY-MM-DD date');
      }
      return updateItem('finance_items', Number(id), {
        name: name || 'Untitled item',
        amount_cents: amount,
        due_day: normalizedDay,
        due_date: normalizedDate,
        note: note || '',
        sync_status: 'pending',
      });
    },
    async move_finance_item({ id, parentId, parent_id, beforeId, before_id }) {
      const items = storeGet('finance_items', []);
      const sourceId = Number(id);
      const newParentId = parentId ?? parent_id ?? null;
      const targetParentId = newParentId == null ? null : Number(newParentId);
      const nextBeforeId = beforeId ?? before_id ?? null;
      const targetBeforeId = nextBeforeId == null ? null : Number(nextBeforeId);
      const source = items.find(item => Number(item.id) === sourceId && item.sync_status !== 'deleted');
      if (!source) throw new Error('finance item not found');
      if (targetParentId === sourceId || targetBeforeId === sourceId) {
        throw new Error('finance item cannot be moved into or before itself');
      }
      const planId = Number(source.plan_id);
      if (targetParentId != null) {
        const parent = items.find(item => Number(item.id) === targetParentId && item.sync_status !== 'deleted');
        if (!parent || Number(parent.plan_id) !== planId) {
          throw new Error('target parent must belong to the same plan');
        }
        let current = targetParentId;
        while (current != null) {
          if (Number(current) === sourceId) {
            throw new Error('finance item cannot be moved into its descendant');
          }
          const parentItem = items.find(item => Number(item.id) === Number(current));
          current = parentItem ? parentItem.parent_id : null;
        }
      }
      if (targetBeforeId != null) {
        const before = items.find(item => Number(item.id) === targetBeforeId && item.sync_status !== 'deleted');
        if (!before || Number(before.plan_id) !== planId || (before.parent_id ?? null) !== targetParentId) {
          throw new Error('before item must belong to the target parent and plan');
        }
      }
      const oldParentId = source.parent_id ?? null;
      const normalizeBucket = (bucketParentId, forcedOrder = null) => {
        const bucket = forcedOrder || items
          .filter(item =>
            Number(item.plan_id) === planId
            && Number(item.id) !== sourceId
            && (item.parent_id ?? null) === bucketParentId
            && item.sync_status !== 'deleted'
          )
          .sort((a, b) =>
            (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
            || String(a.name || '').localeCompare(String(b.name || ''))
            || Number(a.id) - Number(b.id)
          )
          .map(item => Number(item.id));
        bucket.forEach((itemId, index) => {
          const item = items.find(x => Number(x.id) === itemId);
          if (!item) return;
          item.parent_id = bucketParentId;
          item.sort_order = index;
          item.updated_at = now();
          item.sync_status = 'pending';
        });
      };
      if (oldParentId !== targetParentId) normalizeBucket(oldParentId);
      const newBucket = items
        .filter(item =>
          Number(item.plan_id) === planId
          && Number(item.id) !== sourceId
          && (item.parent_id ?? null) === targetParentId
          && item.sync_status !== 'deleted'
        )
        .sort((a, b) =>
          (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
          || String(a.name || '').localeCompare(String(b.name || ''))
          || Number(a.id) - Number(b.id)
        )
        .map(item => Number(item.id));
      const insertAt = targetBeforeId == null ? newBucket.length : Math.max(0, newBucket.indexOf(targetBeforeId));
      newBucket.splice(insertAt, 0, sourceId);
      normalizeBucket(targetParentId, newBucket);
      storeSet('finance_items', items);
    },
    async delete_finance_item({ id }) {
      const sourceId = Number(id);
      const items = storeGet('finance_items', []);
      const toDelete = new Set([sourceId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of items) {
          if (toDelete.has(Number(item.parent_id)) && !toDelete.has(Number(item.id))) {
            toDelete.add(Number(item.id));
            changed = true;
          }
        }
      }
      storeSet('finance_items', items.map(item => (
        toDelete.has(Number(item.id))
          ? { ...item, sync_status: 'deleted', updated_at: now() }
          : item
      )));
      storeSet('finance_payments', storeGet('finance_payments', []).map(payment => (
        toDelete.has(Number(payment.item_id))
          ? { ...payment, sync_status: 'deleted', updated_at: now() }
          : payment
      )));
    },
    async list_finance_payments({ planId, plan_id }) {
      const targetPlanId = Number(planId ?? plan_id);
      return [...storeGet('finance_payments', [])]
        .filter(payment => Number(payment.plan_id) === targetPlanId && payment.sync_status !== 'deleted')
        .sort((a, b) =>
          String(a.month_key || '').localeCompare(String(b.month_key || ''))
          || Number(a.item_id) - Number(b.item_id)
          || Number(a.id) - Number(b.id)
        );
    },
    async upsert_finance_payment({
      planId,
      plan_id,
      itemId,
      item_id,
      monthKey,
      month_key,
      isPaid,
      is_paid,
      paidAmountCents,
      paid_amount_cents,
      note,
    }) {
      const targetPlanId = Number(planId ?? plan_id);
      const targetItemId = Number(itemId ?? item_id);
      const targetMonth = String(monthKey ?? month_key ?? '').trim();
      if (!/^\d{4}-\d{2}$/.test(targetMonth)) throw new Error('month_key must be a valid YYYY-MM month');
      const [, month] = targetMonth.split('-').map(Number);
      if (month < 1 || month > 12) throw new Error('month_key must be a valid YYYY-MM month');
      const amount = Number(paidAmountCents ?? paid_amount_cents ?? 0);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('paid_amount_cents must be non-negative');
      const plan = storeGet('finance_plans', []).find(p => Number(p.id) === targetPlanId && p.sync_status !== 'deleted');
      if (!plan) throw new Error('finance plan not found');
      if ((plan.kind || 'monthly') !== 'monthly') throw new Error('finance payments are available only for monthly plans');
      const item = storeGet('finance_items', []).find(i => Number(i.id) === targetItemId && i.sync_status !== 'deleted');
      if (!item) throw new Error('finance item not found');
      if (Number(item.plan_id) !== targetPlanId) throw new Error('finance item must belong to the same plan');
      const payments = storeGet('finance_payments', []);
      const existing = payments.find(payment =>
        Number(payment.plan_id) === targetPlanId
        && Number(payment.item_id) === targetItemId
        && String(payment.month_key) === targetMonth
      );
      if (existing) {
        return updateItem('finance_payments', Number(existing.id), {
          is_paid: Boolean(isPaid ?? is_paid),
          paid_amount_cents: amount,
          note: note || '',
          sync_status: 'pending',
        });
      }
      return createItem('finance_payments', {
        uuid: uuid(),
        plan_id: targetPlanId,
        item_id: targetItemId,
        month_key: targetMonth,
        is_paid: Boolean(isPaid ?? is_paid),
        paid_amount_cents: amount,
        note: note || '',
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },

    // ── Tasks ───────────────────────────────────────────
    async list_task_categories() {
      return storeGet('task_categories', []).sort((a, b) => a.sort_order - b.sort_order);
    },
    async list_task_statuses() {
      return storeGet('task_statuses', []).sort((a, b) => a.sort_order - b.sort_order);
    },
    async list_tasks({ category, status }) {
      let items = storeGet('tasks', []).filter(t => t.sync_status !== 'deleted');
      if (category === 'none') items = items.filter(t => t.category_id == null);
      else if (category != null) items = items.filter(t => String(t.category_id) === String(category));
      if (status === 'none') items = items.filter(t => t.status_id == null);
      else if (status != null) items = items.filter(t => String(t.status_id) === String(status));
      return items.sort((a, b) =>
        Number(b.is_pinned) - Number(a.is_pinned) || a.sort_order - b.sort_order || a.id - b.id
      );
    },
    async list_pinned_tasks() {
      return storeGet('tasks', [])
        .filter(t => t.sync_status !== 'deleted' && t.is_pinned)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    },
    async create_task({ title, categoryId, statusId }) {
      const sortOrder = storeGet('tasks', [])
        .filter(t => t.sync_status !== 'deleted')
        .reduce((max, t) => Math.max(max, Number(t.sort_order) || 0), -1) + 1;
      return createItem('tasks', {
        uuid: uuid(),
        title: title || 'New task',
        category_id: categoryId ?? null,
        status_id: statusId ?? null,
        is_pinned: false,
        bg_color: null,
        tracker_url: null,
        notes_md: '',
        sort_order: sortOrder,
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },
    async update_task({ id, title, categoryId, statusId, isPinned, bgColor, trackerUrl, notesMd }) {
      return updateItem('tasks', id, {
        title,
        category_id: categoryId ?? null,
        status_id: statusId ?? null,
        is_pinned: !!isPinned,
        bg_color: bgColor ?? null,
        tracker_url: trackerUrl ?? null,
        notes_md: notesMd || '',
      });
    },
    async reorder_tasks({ ids }) {
      const order = new Map((ids || []).map((id, index) => [Number(id), index]));
      const tasks = storeGet('tasks', []).map(t => (
        order.has(Number(t.id))
          ? { ...t, sort_order: order.get(Number(t.id)), updated_at: now() }
          : t
      ));
      storeSet('tasks', tasks);
    },
    async delete_task({ id }) {
      updateItem('tasks', id, { sync_status: 'deleted' });
    },
    async list_task_checkboxes({ taskId }) {
      return storeGet('task_checkboxes', []).filter(x => x.task_id === taskId && x.sync_status !== 'deleted');
    },
    async create_task_checkbox({ taskId, parentId, text }) {
      const pid = parentId ?? null;
      const siblings = storeGet('task_checkboxes', [])
        .filter(x => Number(x.task_id) === Number(taskId) && (x.parent_id ?? null) === pid && x.sync_status !== 'deleted');
      const sortOrder = siblings.reduce((max, x) => Math.max(max, Number(x.sort_order) || 0), -1) + 1;
      return createItem('task_checkboxes', {
        uuid: uuid(),
        task_id: Number(taskId),
        parent_id: pid,
        text: text || '',
        is_checked: false,
        sort_order: sortOrder,
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },
    async update_task_checkbox({ id, text, isChecked }) {
      return updateItem('task_checkboxes', id, {
        text: text || '',
        is_checked: !!isChecked,
      });
    },
    async reorder_task_checkboxes({ taskId, entries }) {
      const updates = new Map((entries || []).map(e => [Number(e.id), e]));
      const items = storeGet('task_checkboxes', []).map(x => {
        const entry = updates.get(Number(x.id));
        if (!entry || Number(x.task_id) !== Number(taskId)) return x;
        return {
          ...x,
          parent_id: entry.parent_id ?? null,
          sort_order: entry.sort_order ?? x.sort_order,
          updated_at: now(),
          sync_status: 'pending',
        };
      });
      storeSet('task_checkboxes', items);
    },
    async list_task_links({ taskId }) {
      return storeGet('task_links', [])
        .filter(x => Number(x.task_id) === Number(taskId) && x.sync_status !== 'deleted')
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id));
    },
    async create_task_link({ taskId, url, label }) {
      const siblings = storeGet('task_links', [])
        .filter(x => Number(x.task_id) === Number(taskId) && x.sync_status !== 'deleted');
      const sortOrder = siblings.reduce((max, x) => Math.max(max, Number(x.sort_order) || 0), -1) + 1;
      return createItem('task_links', {
        uuid: uuid(),
        task_id: Number(taskId),
        url: url || '',
        label: label || null,
        sort_order: sortOrder,
        sync_status: 'pending',
        user_id: 'mock-user',
      });
    },
    async update_task_link({ id, url, label }) {
      return updateItem('task_links', id, {
        url: url || '',
        label: label || null,
      });
    },
    async reorder_task_links({ taskId, ids }) {
      const order = new Map((ids || []).map((id, index) => [Number(id), index]));
      const items = storeGet('task_links', []).map(x => {
        if (Number(x.task_id) !== Number(taskId) || !order.has(Number(x.id))) return x;
        return {
          ...x,
          sort_order: order.get(Number(x.id)),
          updated_at: now(),
          sync_status: 'pending',
        };
      });
      storeSet('task_links', items);
    },
    async delete_task_link({ id }) {
      return updateItem('task_links', id, { sync_status: 'deleted' });
    },

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
    async run_command({ command, shell, wslDistro }) {
      recordMockCall('run_command', { command, shell, wslDistro });
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
      return storeGet('repo_groups', []).sort((a, b) =>
        (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name))
      );
    },
    async add_repo_group({ name, icon, color }) {
      if (!name || !name.trim()) throw new Error('Name is required');
      const groups = storeGet('repo_groups', []);
      if (groups.some(g => g.name === name)) throw new Error(`Group '${name}' already exists`);
      const id = (groups.reduce((m, g) => Math.max(m, g.id), 0)) + 1;
      const sort_order = groups.reduce((m, g) => Math.max(m, g.sort_order || 0), -1) + 1;
      const group = { id, name, icon: icon || '', color: color || '#3b82f6', sort_order };
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
    async reorder_repo_groups({ ids }) {
      const order = new Map((ids || []).map((id, idx) => [id, idx]));
      const groups = storeGet('repo_groups', []).sort((a, b) => {
        const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
        const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
        return ai - bi || (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name));
      }).map((g, idx) => ({ ...g, sort_order: idx }));
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
    async reorder_repos({ names }) {
      const order = new Map((names || []).map((name, idx) => [name, idx]));
      const repos = storeGet('repos', []).sort((a, b) => {
        const ai = order.has(a.name) ? order.get(a.name) : Number.MAX_SAFE_INTEGER;
        const bi = order.has(b.name) ? order.get(b.name) : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
      storeSet('repos', repos);
    },
    async search_filenames({ pattern, repos }) {
      storeSet('repo_search_last_search', { type: 'files', query: pattern, repos: repos || [] });
      return [];
    },
    async search_content({ query, repos }) {
      storeSet('repo_search_last_search', { type: 'content', query, repos: repos || [] });
      return [];
    },
    async search_git_history({ query, repos }) {
      storeSet('repo_search_last_search', { type: 'git', query, repos: repos || [] });
      return [];
    },
    async get_file_context() { return []; },

    // v1.2.0 tools
    async open_in_editor({ path, line }) {
      storeSet('repo_search_last_open_editor', { path, line });
      console.log('[mock] open_in_editor', { path, line });
    },
    async read_full_file({ path }) {
      const lang = (path.split('.').pop() || '').toLowerCase();
      const samples = {
        md: '# Sample markdown\n\nA mock file — in prod this reads the real disk.',
        txt: 'plain text sample\nline two\nline three',
        js: 'function hello(name) {\n  return `Hello, ${name}!`;\n}',
        py: 'import os\nimport sys\n\n\ndef hello(name):\n    return f"Hello, {name}!"',
      };
      const content = samples[lang] || `# ${path}\n(mock content for dev)`;
      return { content, truncated: false, size: content.length };
    },
    async repo_search_file_history({ repoPath, filePath, limit }) {
      console.log('[mock] repo_search_file_history', { repoPath, filePath, limit });
      return [
        {
          commit_hash: 'abc123def4567890',
          commit_date: '2026-06-20T10:00:00+00:00',
          author: 'Mock User',
          message: 'update file history sample',
          relative_path: 'sample.py',
        },
        {
          commit_hash: 'def456abc1237890',
          commit_date: '2026-06-19T09:00:00+00:00',
          author: 'Mock User',
          message: 'add python sample',
          relative_path: 'sample.py',
        },
      ];
    },
    async repo_search_file_diff({ repoPath, filePath, hash }) {
      console.log('[mock] repo_search_file_diff', { repoPath, filePath, hash });
      return `diff --git a/sample.py b/sample.py\nindex 1111111..2222222 100644\n--- a/sample.py\n+++ b/sample.py\n@@ -1,4 +1,5 @@\n import os\n+import sys\n \n def hello(name):\n-    return name\n+    return f\"Hello, {name}!\"\n`;
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

    // ── ClickHouse Docs ─────────────────────────────────
    async list_clickhouse_doc_tree() {
      recordMockCall('list_clickhouse_doc_tree');
      const pages = clickhouseMockPages().map(page => ({
        id: page.id,
        category: page.category,
        title: page.title,
        source_url: page.source_url,
        public_url: page.public_url,
        updated_at: page.updated_at,
        section_count: page.sections.length,
      }));
      return {
        pages,
        page_count: pages.length,
        section_count: pages.reduce((sum, page) => sum + page.section_count, 0),
        last_update_at: pages[0]?.updated_at || null,
      };
    },
    async get_clickhouse_doc_page({ pageId }) {
      recordMockCall('get_clickhouse_doc_page', { pageId });
      const page = clickhouseMockPages().find(entry => entry.id === pageId);
      if (!page) throw new Error(`ClickHouse mock page not found: ${pageId}`);
      const result = {
        ...page,
        markdown: '',
        sections: (page.sections || []).map(clickhouseSectionSummary),
      };
      window.__mockClickHouseLastPageBodyChars = String(result.markdown || '').length
        + (result.sections || []).reduce((sum, section) => sum + String(section.body || '').length, 0);
      return result;
    },
    async get_clickhouse_doc_section({ pageId, sectionPath }) {
      recordMockCall('get_clickhouse_doc_section', { pageId, sectionPath });
      const page = clickhouseMockPages().find(entry => entry.id === pageId);
      if (!page) throw new Error(`ClickHouse mock page not found: ${pageId}`);
      const section = (page.sections || []).find(entry => entry.section_path === sectionPath);
      if (!section) throw new Error(`ClickHouse mock section not found: ${sectionPath}`);
      return { ...section, excerpt: clickhouseExcerpt(section.body) };
    },
    async search_clickhouse_docs({ query, limit }) {
      recordMockCall('search_clickhouse_docs', { query, limit });
      const tokens = normalizeClickhouseQuery(query).split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      const sections = clickhouseMockPages().flatMap(page => page.sections);
      return sections
        .map(section => {
          const haystack = section.normalized_search_text || normalizeClickhouseQuery(
            `${section.title} ${section.page_title} ${section.category} ${section.body}`,
          );
          if (!tokens.every(token => haystack.includes(token))) return null;
          const titleNorm = normalizeClickhouseQuery(section.title);
          const queryNorm = normalizeClickhouseQuery(query);
          const score = titleNorm.replace(/\s+/g, '') === queryNorm.replace(/\s+/g, '') ? 220 : 80;
          return {
            section_id: section.id,
            page_id: section.page_id,
            category: section.category,
            page_title: section.page_title,
            section_title: section.title,
            slug: section.slug,
            section_path: section.section_path,
            excerpt: section.body.replace(/\n+/g, ' ').slice(0, 220),
            score,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.section_title.localeCompare(b.section_title))
        .slice(0, limit || 50);
    },
    async update_clickhouse_docs() {
      const runs = storeGet('clickhouse_doc_update_runs', []);
      const startedMs = nowMs();
      const finishedMs = startedMs + 1000;
      const run = {
        id: runs.length + 1,
        started_at: new Date(startedMs).toISOString(),
        finished_at: new Date(finishedMs).toISOString(),
        status: 'success',
        pages_checked: 2,
        pages_updated: 2,
        sections_added: 4,
        sections_changed: 0,
        sections_removed: 0,
        failed_urls: 0,
        summary: '2 page(s) checked, 2 updated, 4 added, 0 changed, 0 removed, 0 failed',
      };
      storeSet('clickhouse_doc_update_runs', [run, ...runs]);
      storeSet(`clickhouse_doc_changes.${run.id}`, [
        { id: 1, run_id: run.id, change_type: 'added', item_type: 'section', title: 'arrayCompact', source_url: 'mock://clickhouse/array-functions.md', details: "Added section 'arrayCompact'" },
      ]);
      const progress = {
        running: false,
        phase: 'done',
        message: 'Complete',
        current: 2,
        total: 2,
        remaining: 0,
        percent: 100,
        started_at: run.started_at,
        finished_at: run.finished_at,
        started_at_ms: startedMs,
        finished_at_ms: finishedMs,
        elapsed_ms: 1000,
        pages_checked: run.pages_checked,
        pages_updated: run.pages_updated,
        sections_added: run.sections_added,
        sections_changed: run.sections_changed,
        sections_removed: run.sections_removed,
        failed_urls: run.failed_urls,
        summary: run.summary,
        error: null,
      };
      storeSet('clickhouse_doc_update_progress', progress);
      emitMockEvent('clickhouse-doc-update-progress', progress);
      return run;
    },
    async get_clickhouse_doc_update_progress() {
      return storeGet('clickhouse_doc_update_progress', {
        running: false,
        phase: 'idle',
        message: 'ClickHouse docs update has not run in this session.',
        current: 0,
        total: 0,
        remaining: 0,
        percent: 0,
        started_at: null,
        finished_at: null,
        started_at_ms: null,
        finished_at_ms: null,
        elapsed_ms: 0,
        pages_checked: 0,
        pages_updated: 0,
        sections_added: 0,
        sections_changed: 0,
        sections_removed: 0,
        failed_urls: 0,
        summary: '',
        error: null,
      });
    },
    async list_clickhouse_doc_update_runs() {
      const runs = storeGet('clickhouse_doc_update_runs', null);
      if (runs) return runs;
      return [{
        id: 1,
        started_at: '2026-06-20T10:00:00.000Z',
        finished_at: '2026-06-20T10:00:01.000Z',
        status: 'success',
        pages_checked: 2,
        pages_updated: 2,
        sections_added: 4,
        sections_changed: 0,
        sections_removed: 0,
        failed_urls: 0,
        summary: '2 page(s) checked, 2 updated, 4 added, 0 changed, 0 removed, 0 failed',
      }];
    },
    async list_clickhouse_doc_changes({ runId }) {
      return storeGet(`clickhouse_doc_changes.${runId}`, [
        { id: 1, run_id: runId, change_type: 'added', item_type: 'section', title: 'arrayCompact', source_url: 'mock://clickhouse/array-functions.md', details: "Added section 'arrayCompact'" },
      ]);
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
    async import_vps_ssh_config_servers() {
      const settings = storeGet('settings', {});
      const windowsPaths = String(settings.vps_ssh_config_windows_paths || '').split('\n').map(s => s.trim()).filter(Boolean);
      const wslPaths = String(settings.vps_ssh_config_wsl_paths || '').split('\n').map(s => s.trim()).filter(Boolean);
      const candidates = [];
      if (windowsPaths.length) {
        candidates.push(
          { name: 'ssh-api', host: '10.44.0.10', user: 'deploy', port: 2222, key_file: '~/.ssh/ssh_api' },
          { name: 'api-prod', host: '10.0.0.1', user: 'deploy', port: 22, key_file: '~/.ssh/id_rsa' },
        );
      }
      if (wslPaths.length) {
        candidates.push({ name: 'ssh-wsl', host: '172.20.1.15', user: 'ubuntu', port: 22, key_file: '~/.ssh/id_ed25519' });
      }
      const servers = storeGet('vps_servers', []);
      const existing = new Set(servers.map(s => String(s.name || '').trim().toLowerCase()));
      const summary = {
        imported: 0,
        skipped_existing: 0,
        ignored_patterns: windowsPaths.length || wslPaths.length ? 1 : 0,
        failed_files: [],
        imported_names: [],
      };
      for (const c of candidates) {
        const key = c.name.trim().toLowerCase();
        if (existing.has(key)) {
          summary.skipped_existing += 1;
          continue;
        }
        existing.add(key);
        servers.push({
          name: c.name,
          host: c.host,
          user: c.user,
          port: c.port,
          key_file: c.key_file,
          color: '#58a6ff',
          auto_refresh: true,
          refresh_interval: 30,
          environment: 'Default',
        });
        summary.imported += 1;
        summary.imported_names.push(c.name);
      }
      storeSet('vps_servers', servers);
      return summary;
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
    async vps_get_detailed_analysis() {
      return {
        hostname: 'api-prod',
        uptime: 'up 3 days, 4:12',
        disk: {
          mount: { path: '/', total: '50G', used: '34G', free: '16G', pct: 67 },
          entries: [
            { path: '/var', name: 'var', parent: '/', depth: 1, size: '18G', bytes: 18000000000, pct_of_used: 52.9 },
            { path: '/var/lib', name: 'lib', parent: '/var', depth: 2, size: '14G', bytes: 14000000000, pct_of_used: 41.2 },
            { path: '/var/lib/docker', name: 'docker', parent: '/var/lib', depth: 3, size: '12G', bytes: 12000000000, pct_of_used: 35.3 },
            { path: '/var/log', name: 'log', parent: '/var', depth: 2, size: '2.1G', bytes: 2100000000, pct_of_used: 6.2 },
            { path: '/home', name: 'home', parent: '/', depth: 1, size: '7.2G', bytes: 7200000000, pct_of_used: 21.2 },
            { path: '/opt', name: 'opt', parent: '/', depth: 1, size: '4.8G', bytes: 4800000000, pct_of_used: 14.1 },
            { path: '/opt/app data', name: 'app data', parent: '/opt', depth: 2, size: '1.6G', bytes: 1600000000, pct_of_used: 4.7 },
          ],
        },
        processes: [
          { pid: 421, command: 'postgres', args: 'postgres', rss_kb: 1887436, memory: '1.8G', mem_pct: 23.1 },
          { pid: 819, command: 'node', args: 'node /srv/app/server.js', rss_kb: 655360, memory: '640M', mem_pct: 8.0 },
          { pid: 1044, command: 'redis-server', args: 'redis-server *:6379', rss_kb: 296960, memory: '290M', mem_pct: 4.0 },
          { pid: 1205, command: 'nginx', args: 'nginx: worker process', rss_kb: 122880, memory: '120M', mem_pct: 2.0 },
        ],
        raw: {
          df: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   34G   16G  67% /',
          du: '18G\t/var\n14G\t/var/lib\n12G\t/var/lib/docker\n2.1G\t/var/log\n7.2G\t/home\n4.8G\t/opt\n1.6G\t/opt/app data',
          ps: 'PID COMMAND COMMAND RSS %MEM\n421 postgres postgres 1887436 23.1\n819 node node /srv/app/server.js 655360 8.0\n1044 redis-server redis-server *:6379 296960 4.0\n1205 nginx nginx: worker process 122880 2.0',
          stderr: "du: cannot read directory '/root': Permission denied",
        },
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
      const settings = storeGet('settings', {});
      const defaultModel = whisperMockState.installedModels.find(m => m.is_default)?.name
        || whisperMockState.installedModels[0]?.name
        || 'ggml-small';
      let engine = settings['whisper.recognition_engine'];
      if (!engine) {
        engine = settings['whisper.live_dictate'] === 'true'
          ? (settings['whisper.live_provider'] === 'yandex' ? 'yandex' : 'deepgram')
          : `local:${defaultModel}`;
      }
      let provider = 'local';
      let model = defaultModel;
      if (engine === 'deepgram' || engine === 'yandex') {
        provider = engine;
        const apiKey = provider === 'yandex'
          ? (settings['whisper.yandex_api_key'] || '')
          : (settings['whisper.deepgram_api_key'] || '');
        if (!String(apiKey).trim()) {
          throw new Error(provider === 'yandex' ? 'Yandex SpeechKit API key is missing' : 'Deepgram API key is missing');
        }
        if (provider === 'yandex' && !String(settings['whisper.yandex_folder_id'] || '').trim()) {
          throw new Error('Yandex batch recognition needs Folder ID. Add Yandex Folder ID in Whisper Settings, or enable Live dictate to use Yandex streaming instead.');
        }
        model = provider === 'yandex'
          ? (settings['whisper.yandex_model'] || 'general')
          : (settings['whisper.deepgram_model'] || 'nova-3');
      } else if (String(engine).startsWith('local:')) {
        model = String(engine).slice('local:'.length) || defaultModel;
      }
      whisperMockState.recordingProvider = provider;
      whisperMockState.recordingModel = model;
      whisperMockState.currentState = 'recording';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'recording', model } }));
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
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'transcribing', model: whisperMockState.recordingModel } }));
      await new Promise(r => setTimeout(r, 400));
      const provider = whisperMockState.recordingProvider || 'local';
      const model = whisperMockState.recordingModel || 'ggml-small';
      const text = provider === 'local'
        ? 'Mocked transcript: это тестовая запись, привет мир.'
        : `Mocked ${provider} transcript: это облачная запись.`;
      whisperMockState.history.unshift({
        id: Date.now(), text, text_raw: null, model_name: model,
        provider, provider_model: model,
        duration_ms: 3000, transcribe_ms: 400, language: 'ru', injected_to: 'paste',
        created_at: Math.floor(Date.now() / 1000),
      });
      whisperMockState.currentState = provider === 'local' ? 'ready' : 'idle';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: whisperMockState.currentState, model: provider === 'local' ? model : null } }));
      window.dispatchEvent(new CustomEvent('whisper:transcribed', { detail: { text, duration_ms: 3000, transcribe_ms: 400, model, language: 'ru' } }));
      return text;
    },
    whisper_cancel_recording() {
      if (whisperMockState.levelTimer) clearInterval(whisperMockState.levelTimer);
      whisperMockState.levelTimer = null;
      whisperMockState.currentState = 'idle';
      window.dispatchEvent(new CustomEvent('whisper:state-changed', { detail: { state: 'idle', model: null } }));
      return null;
    },
    async whisper_stop_active() {
      if (['connecting', 'streaming', 'stopping', 'error'].includes(whisperMockState.liveState)) {
        return handlers.whisper_live_stop();
      }
      if (['warming', 'recording'].includes(whisperMockState.currentState)) {
        return handlers.whisper_stop_recording();
      }
      return '';
    },
    whisper_cancel_active() {
      if (['connecting', 'streaming', 'stopping', 'error'].includes(whisperMockState.liveState)) {
        return handlers.whisper_live_cancel();
      }
      if (['warming', 'recording'].includes(whisperMockState.currentState)) {
        return handlers.whisper_cancel_recording();
      }
      return null;
    },
    whisper_status() {
      const model = whisperMockState.installedModels.find(m => m.is_default)?.name || null;
      return { state: whisperMockState.currentState, model };
    },
    whisper_live_start() {
      const settings = storeGet('settings', {});
      const provider = settings['whisper.live_provider'] === 'yandex' ? 'yandex' : 'deepgram';
      const apiKey = provider === 'yandex'
        ? (settings['whisper.yandex_api_key'] || '')
        : (settings['whisper.deepgram_api_key'] || '');
      if (!String(apiKey).trim()) {
        throw new Error(provider === 'yandex' ? 'Yandex SpeechKit API key is missing' : 'Deepgram API key is missing');
      }
      clearWhisperLiveTimers();
      whisperMockState.liveProvider = provider;
      whisperMockState.liveModel = provider === 'yandex'
        ? (settings['whisper.yandex_model'] || 'general')
        : (settings['whisper.deepgram_model'] || 'nova-3');
      whisperMockState.liveCommittedText = '';
      dispatchWhisperLiveState('connecting');
      whisperMockState.liveTimers.push(setTimeout(() => {
        dispatchWhisperLiveState('streaming');
        whisperMockState.levelTimer = setInterval(() => {
          const rms = 0.2 + 0.5 * Math.abs(Math.sin(Date.now() / 140));
          window.dispatchEvent(new CustomEvent('whisper:live-level', { detail: { rms } }));
        }, 50);
      }, 80));
      whisperMockState.liveTimers.push(setTimeout(() => {
        window.dispatchEvent(new CustomEvent('whisper:live-interim', {
          detail: { text: 'Live mock trans', speech_final: false, provider },
        }));
      }, 180));
      whisperMockState.liveTimers.push(setTimeout(() => {
        dispatchWhisperLiveFinal('Live mock transcript.');
      }, 320));
      return null;
    },
    async whisper_live_stop() {
      const text = whisperMockState.liveCommittedText || 'Live mock transcript.';
      clearWhisperLiveTimers();
      if (!whisperMockState.liveCommittedText) dispatchWhisperLiveFinal(text);
      dispatchWhisperLiveState('stopping');
      await new Promise(r => setTimeout(r, 80));
      whisperMockState.history.unshift({
        id: Date.now(), text, text_raw: null, model_name: whisperMockState.liveModel,
        provider: whisperMockState.liveProvider, provider_model: whisperMockState.liveModel,
        duration_ms: 2000, transcribe_ms: 0, language: 'ru', injected_to: 'paste',
        created_at: Math.floor(Date.now() / 1000),
      });
      dispatchWhisperLiveState('idle', null);
      return text;
    },
    whisper_live_cancel() {
      clearWhisperLiveTimers();
      whisperMockState.liveCommittedText = '';
      dispatchWhisperLiveState('idle', null);
      return null;
    },
    whisper_live_status() {
      return {
        state: whisperMockState.liveState,
        model: whisperMockState.liveModel,
        provider: whisperMockState.liveProvider,
        committed_text: whisperMockState.liveCommittedText,
      };
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
    dialog: {
      open: async (options = {}) => {
        const value = window.__mockDialogOpenResult;
        if (typeof value === 'function') return await value(options);
        if (value !== undefined) return value;
        return options.multiple ? [] : null;
      },
    },
  };

  console.log('[dev-mock] window.__TAURI__ stubbed with', Object.keys(handlers).length, 'handlers');
})();
