import { call } from '../../tauri-api.js';

const RECENT_TASK_KEY = 'ai.recent_task_uuid';

function commandArgs(command) {
  return command?.args && typeof command.args === 'object' ? command.args : {};
}

function textIncludes(value, query) {
  return String(value || '').toLowerCase().includes(String(query || '').trim().toLowerCase());
}

function commandResult(name, args, status, message, extra = {}) {
  return {
    name,
    args,
    status,
    message,
    item_type: extra.itemType || null,
    item_uuid: extra.itemUuid || null,
    choices: extra.choices || [],
  };
}

function localId(item) {
  const raw = item?.id;
  return raw === undefined || raw === null ? null : Number(raw);
}

async function activateTab(tabId, afterEvent = null, afterDetail = {}) {
  const requestId = `ai-nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, 1200);
    window.addEventListener('ai:navigation-complete', function handler(event) {
      if (event.detail?.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('ai:navigation-complete', handler);
      resolve();
    });
  });
  window.dispatchEvent(new CustomEvent('ai:activate-tab', {
    detail: {
      tabId,
      afterEvent,
      afterDetail,
      requestId,
    },
  }));
  await done;
}

async function allTasks() {
  return call('list_tasks', { category: null, status: null });
}

async function findTask(args) {
  const tasks = await allTasks();
  const uuid = args.task_uuid || args.item_uuid;
  if (uuid) {
    const task = tasks.find(t => t.uuid === uuid);
    if (task) return { task, choices: [] };
    return { task: null, choices: [] };
  }

  const query = args.task_query || args.query || args.title || '';
  const matches = query
    ? tasks.filter(t => textIncludes(t.title, query)).slice(0, 5)
    : [];
  if (matches.length === 1) return { task: matches[0], choices: [] };
  return {
    task: null,
    choices: matches.map(t => ({ item_type: 'task', item_uuid: t.uuid, title: t.title })),
  };
}

async function resolveTask(args) {
  if (args.task_ref === 'current' && !args.task_uuid) {
    const recent = localStorage.getItem(RECENT_TASK_KEY);
    if (recent) args = { ...args, task_uuid: recent };
  }
  return findTask(args);
}

async function openTask(command) {
  const args = commandArgs(command);
  const { task, choices } = await findTask(args);
  if (!task && choices.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several tasks match this request.', { choices });
  }
  if (!task) {
    return commandResult(command.name, args, 'failed', 'Task not found.');
  }
  localStorage.setItem(RECENT_TASK_KEY, task.uuid);
  await activateTab('tasks', 'ai:tasks-open', {
    taskId: localId(task),
    taskUuid: task.uuid,
    title: task.title,
  });
  return commandResult(command.name, args, 'executed', `Opened task: ${task.title}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function createTask(command) {
  const args = commandArgs(command);
  const title = String(args.title || '').trim();
  if (!title) return commandResult(command.name, args, 'failed', 'Task title is required.');

  const task = await call('create_task', { title, categoryId: null, statusId: null });
  const taskId = localId(task);
  const checkboxes = Array.isArray(args.checkboxes) ? args.checkboxes : [];
  for (const rawText of checkboxes) {
    const text = String(rawText || '').trim();
    if (!text) continue;
    await call('create_task_checkbox', { taskId, parentId: null, text });
  }
  localStorage.setItem(RECENT_TASK_KEY, task.uuid);
  await activateTab('tasks', 'ai:tasks-open', {
    taskId,
    taskUuid: task.uuid,
    title: task.title,
  });
  return commandResult(command.name, args, 'executed', `Created task: ${task.title}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function addTaskCheckbox(command) {
  const args = commandArgs(command);
  const text = String(args.text || '').trim();
  if (!text) return commandResult(command.name, args, 'failed', 'Checkbox text is required.');

  const { task, choices } = await resolveTask(args);
  if (!task && choices.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several tasks match this request.', { choices });
  }
  if (!task) return commandResult(command.name, args, 'failed', 'Task not found.');

  await call('create_task_checkbox', { taskId: localId(task), parentId: null, text });
  localStorage.setItem(RECENT_TASK_KEY, task.uuid);
  await activateTab('tasks', 'ai:tasks-open', {
    taskId: localId(task),
    taskUuid: task.uuid,
    title: task.title,
  });
  return commandResult(command.name, args, 'executed', `Added checkbox to ${task.title}: ${text}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function completeTaskCheckbox(command) {
  const args = commandArgs(command);
  const { task, choices } = await resolveTask(args);
  if (!task && choices.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several tasks match this request.', { choices });
  }
  if (!task) return commandResult(command.name, args, 'failed', 'Task not found.');

  const boxes = await call('list_task_checkboxes', { taskId: localId(task) });
  const checkboxUuid = args.checkbox_uuid || args.item_uuid;
  const query = args.checkbox_query || args.query || args.text || '';
  const matches = boxes.filter(box => {
    if (checkboxUuid && box.uuid === checkboxUuid) return true;
    return query && textIncludes(box.text, query);
  });
  if (matches.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several checkboxes match this request.', {
      choices: matches.slice(0, 5).map(box => ({ item_type: 'task_checkbox', item_uuid: box.uuid, title: box.text })),
    });
  }
  if (matches.length === 0) return commandResult(command.name, args, 'failed', 'Checkbox not found.');

  const box = matches[0];
  await call('update_task_checkbox', { id: localId(box), text: box.text || '', isChecked: true });
  localStorage.setItem(RECENT_TASK_KEY, task.uuid);
  await activateTab('tasks', 'ai:tasks-open', {
    taskId: localId(task),
    taskUuid: task.uuid,
    title: task.title,
  });
  return commandResult(command.name, args, 'executed', `Completed checkbox: ${box.text}`, {
    itemType: 'task_checkbox',
    itemUuid: box.uuid,
  });
}

async function allNotes() {
  const folders = await call('list_note_folders');
  const result = [];
  for (const folder of folders) {
    const rows = await call('list_notes', { folderId: folder.id }).catch(() => []);
    result.push(...rows);
  }
  return result;
}

async function findNote(args) {
  const notes = await allNotes();
  const uuid = args.note_uuid || args.item_uuid;
  if (uuid) {
    return {
      note: notes.find(n => n.uuid === uuid) || null,
      choices: [],
    };
  }
  const query = args.query || args.title || '';
  const matches = query
    ? notes.filter(n => textIncludes(n.title, query) || textIncludes(n.content, query)).slice(0, 5)
    : [];
  return {
    note: matches.length === 1 ? matches[0] : null,
    choices: matches.map(n => ({ item_type: 'note', item_uuid: n.uuid, title: n.title || '(untitled)' })),
  };
}

async function allSnippets() {
  return call('list_shortcuts');
}

async function findSnippet(args) {
  const snippets = await allSnippets();
  const uuid = args.snippet_uuid || args.shortcut_uuid || args.item_uuid;
  if (uuid) {
    return {
      snippet: snippets.find(s => s.uuid === uuid) || null,
      choices: [],
    };
  }
  const query = args.query || args.name || '';
  const matches = query
    ? snippets.filter(s => (
      textIncludes(s.name, query)
      || textIncludes(s.value, query)
      || textIncludes(s.description, query)
    )).slice(0, 5)
    : [];
  return {
    snippet: matches.length === 1 ? matches[0] : null,
    choices: matches.map(s => ({ item_type: 'shortcut', item_uuid: s.uuid, title: s.name || '(untitled)' })),
  };
}

async function openNote(command) {
  const args = commandArgs(command);
  const { note, choices } = await findNote(args);
  if (!note && choices.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several notes match this request.', { choices });
  }
  if (!note) return commandResult(command.name, args, 'failed', 'Note not found.');
  await activateTab('notes', 'ai:notes-open', {
    noteUuid: note.uuid,
    query: '',
  });
  return commandResult(command.name, args, 'executed', `Opened note: ${note.title || '(untitled)'}`, {
    itemType: 'note',
    itemUuid: note.uuid,
  });
}

async function openSnippet(command) {
  const args = commandArgs(command);
  const { snippet, choices } = await findSnippet(args);
  if (!snippet && choices.length > 1) {
    return commandResult(command.name, args, 'needs_clarification', 'Several snippets match this request.', { choices });
  }
  if (!snippet) return commandResult(command.name, args, 'failed', 'Snippet not found.');
  await activateTab('shortcuts', 'ai:snippets-open', {
    snippetUuid: snippet.uuid,
    query: '',
  });
  return commandResult(command.name, args, 'executed', `Opened snippet: ${snippet.name || '(untitled)'}`, {
    itemType: 'shortcut',
    itemUuid: snippet.uuid,
  });
}

async function searchTasks(command) {
  const args = commandArgs(command);
  const tasks = await allTasks();
  const query = args.query || '';
  const matches = query ? tasks.filter(t => textIncludes(t.title, query)).slice(0, 5) : [];
  if (matches.length === 1) {
    localStorage.setItem(RECENT_TASK_KEY, matches[0].uuid);
  }
  return commandResult(command.name, args, matches.length ? 'executed' : 'failed', matches.length ? `Found ${matches.length} task(s).` : 'No tasks found.', {
    choices: matches.map(t => ({ item_type: 'task', item_uuid: t.uuid, title: t.title })),
  });
}

async function searchNotes(command) {
  const args = commandArgs(command);
  const { choices } = await findNote(args);
  await activateTab('notes', 'ai:notes-search', { query: args.query || '' });
  return commandResult(command.name, args, choices.length ? 'executed' : 'failed', choices.length ? `Found ${choices.length} note(s).` : 'No notes found.', {
    choices,
  });
}

async function searchSnippets(command) {
  const args = commandArgs(command);
  const { choices } = await findSnippet(args);
  await activateTab('shortcuts', 'ai:snippets-search', { query: args.query || '' });
  return commandResult(command.name, args, choices.length ? 'executed' : 'failed', choices.length ? `Found ${choices.length} snippet(s).` : 'No snippets found.', {
    choices,
  });
}

const HANDLERS = {
  search_tasks: searchTasks,
  open_task: openTask,
  show_task: openTask,
  add_task_checkbox: addTaskCheckbox,
  complete_task_checkbox: completeTaskCheckbox,
  create_task: createTask,
  search_notes: searchNotes,
  open_note: openNote,
  search_snippets: searchSnippets,
  open_snippet: openSnippet,
};

export async function executeAiCommands(commands = []) {
  const results = [];
  for (const command of commands) {
    const name = command?.name;
    const handler = HANDLERS[name];
    if (!handler) {
      results.push(commandResult(name || 'unknown', commandArgs(command), 'failed', 'Unsupported command.'));
      continue;
    }
    try {
      results.push(await handler(command));
    } catch (err) {
      results.push(commandResult(name, commandArgs(command), 'failed', String(err)));
    }
  }
  return results;
}
