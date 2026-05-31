import {
  getAllTasks,
  getTaskCheckboxes,
  getNextTaskSortOrder,
  setTaskCheckboxChecked,
  upsertTask,
  upsertTaskCheckbox,
} from '../db/taskRepo';
import { getAllNotes } from '../db/noteRepo';
import { getAllSnippets } from '../db/snippetRepo';
import { notifyLocalChange } from '../sync/syncService';
import { uuidv4 } from '../lib/uuid';

function nowIso() {
  return new Date().toISOString();
}

const defaultDeps = {
  nowIso,
  uuidv4,
  getAllTasks,
  getAllNotes,
  getAllSnippets,
  getTaskCheckboxes,
  getNextTaskSortOrder,
  upsertTask,
  upsertTaskCheckbox,
  setTaskCheckboxChecked,
  notifyLocalChange,
};

function commandArgs(command) {
  return command?.args && typeof command.args === 'object' ? command.args : {};
}

function includesText(value, query) {
  return String(value || '').toLowerCase().includes(String(query || '').trim().toLowerCase());
}

function result(name, args, status, message, extra = {}) {
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

function choice(itemType, itemUuid, title) {
  return { item_type: itemType, item_uuid: itemUuid, title };
}

function userAskedToOpenSingleResult(context) {
  const text = String(context?.user_message || '').toLowerCase();
  if (!text) return false;
  const wantsListOnly = /(список|перечисли|найди|поиск|list|search)/i.test(text);
  if (wantsListOnly) return false;
  return /(покажи|показать|открой|открыть|show|open)/i.test(text);
}

function autoOpenCommandForSearch(commandName, searchResult, context) {
  if (!userAskedToOpenSingleResult(context)) return null;
  if (searchResult?.status !== 'executed' || searchResult?.choices?.length !== 1) return null;
  const [selected] = searchResult.choices;
  if (commandName === 'search_tasks') {
    return { name: 'open_task', args: { task_uuid: selected.item_uuid } };
  }
  if (commandName === 'search_notes') {
    return { name: 'open_note', args: { note_uuid: selected.item_uuid } };
  }
  if (commandName === 'search_snippets') {
    return { name: 'open_snippet', args: { snippet_uuid: selected.item_uuid } };
  }
  return null;
}

async function findTask(args, context, deps) {
  const all = await deps.getAllTasks();
  const explicitUuid = args.task_uuid || args.item_uuid || (
    args.task_ref === 'current' ? context?.recent_task_uuid : null
  );
  if (explicitUuid) {
    return {
      item: all.find((task) => task.uuid === explicitUuid) || null,
      choices: [],
    };
  }
  const query = args.query || args.title || '';
  const matches = query ? all.filter((task) => includesText(task.title, query)).slice(0, 5) : [];
  return {
    item: matches.length === 1 ? matches[0] : null,
    choices: matches.map((task) => choice('task', task.uuid, task.title || 'Без названия')),
  };
}

async function findNote(args, deps) {
  const all = await deps.getAllNotes();
  const uuid = args.note_uuid || args.item_uuid;
  if (uuid) {
    return {
      item: all.find((note) => note.uuid === uuid) || null,
      choices: [],
    };
  }
  const query = args.query || args.title || '';
  const matches = query
    ? all.filter((note) => includesText(note.title, query) || includesText(note.content, query)).slice(0, 5)
    : [];
  return {
    item: matches.length === 1 ? matches[0] : null,
    choices: matches.map((note) => choice('note', note.uuid, note.title || 'Без названия')),
  };
}

async function findSnippet(args, deps) {
  const all = await deps.getAllSnippets();
  const uuid = args.snippet_uuid || args.shortcut_uuid || args.item_uuid;
  if (uuid) {
    return {
      item: all.find((snippet) => snippet.uuid === uuid) || null,
      choices: [],
    };
  }
  const query = args.query || args.name || '';
  const matches = query
    ? all.filter((snippet) => (
      includesText(snippet.name, query)
      || includesText(snippet.value, query)
      || includesText(snippet.description, query)
    )).slice(0, 5)
    : [];
  return {
    item: matches.length === 1 ? matches[0] : null,
    choices: matches.map((snippet) => choice('shortcut', snippet.uuid, snippet.name || 'Без названия')),
  };
}

function openTask(navigation, task) {
  navigation.navigate('Tasks', {
    screen: 'TaskEditor',
    params: { task, isNew: false },
  });
}

function openNote(navigation, note) {
  navigation.navigate('Notes', {
    screen: 'NoteEditor',
    params: { note },
  });
}

function openSnippet(navigation, snippet) {
  navigation.navigate('Snippets', {
    screen: 'SnippetDetail',
    params: { snippet },
  });
}

async function handleOpenTask(command, navigation, context, deps) {
  const args = commandArgs(command);
  const { item: task, choices } = await findTask(args, context, deps);
  if (!task && choices.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько задач.', { choices });
  }
  if (!task) return result(command.name, args, 'failed', 'Задача не найдена.');
  context.recent_task_uuid = task.uuid;
  openTask(navigation, task);
  return result(command.name, args, 'executed', `Открыта задача: ${task.title || 'Без названия'}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function handleCreateTask(command, navigation, context, deps) {
  const args = commandArgs(command);
  const title = String(args.title || '').trim();
  if (!title) return result(command.name, args, 'failed', 'Нужно название задачи.');

  const createdAt = deps.nowIso();
  const task = {
    uuid: deps.uuidv4(),
    title,
    category_uuid: null,
    status_uuid: null,
    is_pinned: 0,
    bg_color: null,
    tracker_url: '',
    notes_md: '',
    sort_order: await deps.getNextTaskSortOrder('tasks'),
    created_at: createdAt,
    updated_at: createdAt,
    is_deleted: 0,
  };
  await deps.upsertTask(task);

  const checkboxes = Array.isArray(args.checkboxes) ? args.checkboxes : [];
  for (let index = 0; index < checkboxes.length; index += 1) {
    const text = String(checkboxes[index] || '').trim();
    if (!text) continue;
    await deps.upsertTaskCheckbox({
      uuid: deps.uuidv4(),
      task_uuid: task.uuid,
      parent_uuid: null,
      text,
      is_checked: 0,
      sort_order: index,
      created_at: createdAt,
      updated_at: createdAt,
      is_deleted: 0,
    });
  }

  deps.notifyLocalChange();
  context.recent_task_uuid = task.uuid;
  openTask(navigation, task);
  return result(command.name, args, 'executed', `Создана задача: ${task.title}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function handleAddTaskCheckbox(command, navigation, context, deps) {
  const args = commandArgs(command);
  const text = String(args.text || '').trim();
  if (!text) return result(command.name, args, 'failed', 'Нужен текст чекбокса.');

  const { item: task, choices } = await findTask(args, context, deps);
  if (!task && choices.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько задач.', { choices });
  }
  if (!task) return result(command.name, args, 'failed', 'Задача не найдена.');

  const createdAt = deps.nowIso();
  const sortOrder = await deps.getNextTaskSortOrder('task_checkboxes', 'task_uuid', task.uuid);
  await deps.upsertTaskCheckbox({
    uuid: deps.uuidv4(),
    task_uuid: task.uuid,
    parent_uuid: null,
    text,
    is_checked: 0,
    sort_order: sortOrder,
    created_at: createdAt,
    updated_at: createdAt,
    is_deleted: 0,
  });
  deps.notifyLocalChange();
  context.recent_task_uuid = task.uuid;
  openTask(navigation, task);
  return result(command.name, args, 'executed', `Добавлен пункт: ${text}`, {
    itemType: 'task',
    itemUuid: task.uuid,
  });
}

async function handleCompleteTaskCheckbox(command, navigation, context, deps) {
  const args = commandArgs(command);
  const { item: task, choices } = await findTask(args, context, deps);
  if (!task && choices.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько задач.', { choices });
  }
  if (!task) return result(command.name, args, 'failed', 'Задача не найдена.');

  const boxes = await deps.getTaskCheckboxes(task.uuid);
  const checkboxUuid = args.checkbox_uuid || args.item_uuid;
  const query = args.query || args.text || '';
  const matches = boxes.filter((box) => (
    (checkboxUuid && box.uuid === checkboxUuid)
    || (query && includesText(box.text, query))
  ));
  if (matches.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько чекбоксов.', {
      choices: matches.slice(0, 5).map((box) => choice('task_checkbox', box.uuid, box.text || '')),
    });
  }
  if (!matches.length) return result(command.name, args, 'failed', 'Чекбокс не найден.');

  const updated = await deps.setTaskCheckboxChecked(matches[0], true, deps.nowIso());
  deps.notifyLocalChange();
  context.recent_task_uuid = task.uuid;
  openTask(navigation, task);
  return result(command.name, args, 'executed', `Отмечен пункт: ${updated.text || matches[0].text}`, {
    itemType: 'task_checkbox',
    itemUuid: updated.uuid || matches[0].uuid,
  });
}

async function handleOpenNote(command, navigation, _context, deps) {
  const args = commandArgs(command);
  const { item: note, choices } = await findNote(args, deps);
  if (!note && choices.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько заметок.', { choices });
  }
  if (!note) return result(command.name, args, 'failed', 'Заметка не найдена.');
  openNote(navigation, note);
  return result(command.name, args, 'executed', `Открыта заметка: ${note.title || 'Без названия'}`, {
    itemType: 'note',
    itemUuid: note.uuid,
  });
}

async function handleOpenSnippet(command, navigation, _context, deps) {
  const args = commandArgs(command);
  const { item: snippet, choices } = await findSnippet(args, deps);
  if (!snippet && choices.length > 1) {
    return result(command.name, args, 'needs_clarification', 'Найдено несколько сниппетов.', { choices });
  }
  if (!snippet) return result(command.name, args, 'failed', 'Сниппет не найден.');
  openSnippet(navigation, snippet);
  return result(command.name, args, 'executed', `Открыт сниппет: ${snippet.name || 'Без названия'}`, {
    itemType: 'shortcut',
    itemUuid: snippet.uuid,
  });
}

async function handleSearchTasks(command, _navigation, context, deps) {
  const args = commandArgs(command);
  const { choices } = await findTask(args, context, deps);
  return result(command.name, args, choices.length ? 'executed' : 'failed', choices.length ? `Найдено задач: ${choices.length}` : 'Задачи не найдены.', { choices });
}

async function handleSearchNotes(command, _navigation, _context, deps) {
  const args = commandArgs(command);
  const { choices } = await findNote(args, deps);
  return result(command.name, args, choices.length ? 'executed' : 'failed', choices.length ? `Найдено заметок: ${choices.length}` : 'Заметки не найдены.', { choices });
}

async function handleSearchSnippets(command, _navigation, _context, deps) {
  const args = commandArgs(command);
  const { choices } = await findSnippet(args, deps);
  return result(command.name, args, choices.length ? 'executed' : 'failed', choices.length ? `Найдено сниппетов: ${choices.length}` : 'Сниппеты не найдены.', { choices });
}

const HANDLERS = {
  search_tasks: handleSearchTasks,
  open_task: handleOpenTask,
  add_task_checkbox: handleAddTaskCheckbox,
  complete_task_checkbox: handleCompleteTaskCheckbox,
  create_task: handleCreateTask,
  search_notes: handleSearchNotes,
  open_note: handleOpenNote,
  search_snippets: handleSearchSnippets,
  open_snippet: handleOpenSnippet,
};

export async function executeMobileAiCommands(commands = [], navigation, context = {}, deps = defaultDeps) {
  const results = [];
  for (const command of commands) {
    const name = command?.name;
    const handler = HANDLERS[name];
    if (!handler) {
      results.push(result(name || 'unknown', commandArgs(command), 'failed', 'Команда не поддерживается.'));
      continue;
    }
    try {
      const commandResult = await handler(command, navigation, context, deps);
      results.push(commandResult);
      const followUp = autoOpenCommandForSearch(name, commandResult, context);
      if (followUp) {
        const followUpHandler = HANDLERS[followUp.name];
        results.push(await followUpHandler(followUp, navigation, context, deps));
      }
    } catch (e) {
      results.push(result(name, commandArgs(command), 'failed', String(e)));
    }
  }
  return results;
}
