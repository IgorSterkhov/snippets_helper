import { executeMobileAiCommands } from '../../src/ai/commandDispatcher';

describe('mobile AI command dispatcher', () => {
  function makeDeps(overrides = {}) {
    return {
      nowIso: () => '2026-05-29T10:00:00.000Z',
      uuidv4: jest.fn()
        .mockReturnValueOnce('task-new')
        .mockReturnValueOnce('cb-new-1')
        .mockReturnValueOnce('cb-new-2'),
      getAllTasks: jest.fn().mockResolvedValue([
        { uuid: 'task-1', title: 'Аптека', sort_order: 0 },
        { uuid: 'task-2', title: 'Аптека старая', sort_order: 1 },
      ]),
      getAllNotes: jest.fn().mockResolvedValue([]),
      getAllSnippets: jest.fn().mockResolvedValue([]),
      getTaskCheckboxes: jest.fn().mockResolvedValue([]),
      getNextTaskSortOrder: jest.fn().mockResolvedValue(7),
      upsertTask: jest.fn().mockResolvedValue(undefined),
      upsertTaskCheckbox: jest.fn().mockResolvedValue(undefined),
      setTaskCheckboxChecked: jest.fn().mockResolvedValue(undefined),
      notifyLocalChange: jest.fn(),
      ...overrides,
    };
  }

  test('create_task writes local task and root checkboxes then opens it', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({ getAllTasks: jest.fn().mockResolvedValue([]) });

    const results = await executeMobileAiCommands([
      { name: 'create_task', args: { title: 'Аптека', checkboxes: ['купить аспирин', 'проверить рецепт'] } },
    ], navigation, {}, deps);

    expect(results[0]).toEqual(expect.objectContaining({ name: 'create_task', status: 'executed', item_uuid: 'task-new' }));
    expect(deps.upsertTask).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'task-new', title: 'Аптека' }));
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'cb-new-1', task_uuid: 'task-new', text: 'купить аспирин' }));
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'cb-new-2', task_uuid: 'task-new', text: 'проверить рецепт' }));
    expect(deps.notifyLocalChange).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('Tasks', expect.objectContaining({
      screen: 'TaskEditor',
      params: expect.objectContaining({ isNew: false }),
    }));
  });

  test('open_task asks for clarification when local matches are ambiguous', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps();

    const results = await executeMobileAiCommands([
      { name: 'open_task', args: { query: 'аптека' } },
    ], navigation, {}, deps);

    expect(results[0].status).toBe('needs_clarification');
    expect(results[0].choices).toHaveLength(2);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('search_tasks opens the only match when the user asked to show it', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      getAllTasks: jest.fn().mockResolvedValue([{ uuid: 'task-1', title: 'Аптека', sort_order: 0 }]),
    });
    const context = { user_message: 'покажи задачу Аптека' };

    const results = await executeMobileAiCommands([
      { name: 'search_tasks', args: { query: 'Аптека' } },
    ], navigation, context, deps);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'search_tasks', status: 'executed' }));
    expect(results[1]).toEqual(expect.objectContaining({ name: 'open_task', status: 'executed', item_uuid: 'task-1' }));
    expect(context.recent_task_uuid).toBe('task-1');
    expect(navigation.navigate).toHaveBeenCalledWith('Tasks', expect.objectContaining({
      screen: 'TaskEditor',
      params: expect.objectContaining({ isNew: false, collapsed: true }),
    }));
  });

  test('search_tasks follows an add-checkbox user request when one task matches', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      uuidv4: jest.fn().mockReturnValue('cb-new'),
      getAllTasks: jest.fn().mockResolvedValue([{ uuid: 'task-1', title: 'Аптека', sort_order: 0 }]),
    });
    const context = { user_message: 'Добавь в задачу аптека пункт купить монетазон.' };

    const results = await executeMobileAiCommands([
      { name: 'search_tasks', args: { query: 'Аптека' } },
    ], navigation, context, deps);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'search_tasks', status: 'executed' }));
    expect(results[1]).toEqual(expect.objectContaining({ name: 'add_task_checkbox', status: 'executed', item_uuid: 'task-1' }));
    expect(deps.upsertTask).not.toHaveBeenCalled();
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({
      uuid: 'cb-new',
      task_uuid: 'task-1',
      text: 'купить монетазон',
    }));
    expect(navigation.navigate).toHaveBeenCalledWith('Tasks', expect.objectContaining({
      screen: 'TaskEditor',
      params: expect.objectContaining({ isNew: false, collapsed: true }),
    }));
  });

  test('search_tasks follows find-task-then-add-there phrasing', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      uuidv4: jest.fn().mockReturnValue('cb-new'),
      getAllTasks: jest.fn().mockResolvedValue([{ uuid: 'task-1', title: 'Аптека', sort_order: 0 }]),
    });
    const context = { user_message: 'Найди задачу аптека и добавь туда пункт купить фенотропил.' };

    const results = await executeMobileAiCommands([
      { name: 'search_tasks', args: { query: 'Аптека' } },
    ], navigation, context, deps);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'search_tasks', status: 'executed' }));
    expect(results[1]).toEqual(expect.objectContaining({ name: 'add_task_checkbox', status: 'executed', item_uuid: 'task-1' }));
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({
      uuid: 'cb-new',
      task_uuid: 'task-1',
      text: 'купить фенотропил',
    }));
  });

  test('search_tasks asks for clarification for ambiguous add-checkbox requests', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      uuidv4: jest.fn().mockReturnValue('cb-new'),
      getAllTasks: jest.fn().mockResolvedValue([
        { uuid: 'task-1', title: 'Аптека', sort_order: 0 },
        { uuid: 'task-2', title: 'Аптека старая', sort_order: 1 },
      ]),
    });
    const context = { user_message: 'Добавь в задачу аптека пункт купить монетазон.' };

    const results = await executeMobileAiCommands([
      { name: 'search_tasks', args: { query: 'Аптека' } },
    ], navigation, context, deps);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'search_tasks', status: 'needs_clarification' }));
    expect(results[0].choices).toHaveLength(2);
    expect(deps.upsertTaskCheckbox).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('create_task does not duplicate an existing task for a dropped-preposition checkbox phrase', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      uuidv4: jest.fn().mockReturnValue('cb-new'),
      getAllTasks: jest.fn().mockResolvedValue([{ uuid: 'task-1', title: 'Аптека', sort_order: 0 }]),
    });
    const context = { user_message: 'Добавь задачу аптека пункт купить монетазон.' };

    const results = await executeMobileAiCommands([
      { name: 'create_task', args: { title: 'Аптека', checkboxes: ['купить монетазон'] } },
    ], navigation, context, deps);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ name: 'add_task_checkbox', status: 'executed', item_uuid: 'task-1' }));
    expect(deps.upsertTask).not.toHaveBeenCalled();
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({
      uuid: 'cb-new',
      task_uuid: 'task-1',
      text: 'купить монетазон',
    }));
  });

  test('add_task_checkbox uses recent task context', async () => {
    const navigation = { navigate: jest.fn() };
    const deps = makeDeps({
      uuidv4: jest.fn().mockReturnValue('cb-new'),
      getAllTasks: jest.fn().mockResolvedValue([{ uuid: 'task-1', title: 'Аптека', sort_order: 0 }]),
    });

    const results = await executeMobileAiCommands([
      { name: 'add_task_checkbox', args: { task_ref: 'current', text: 'купить аспирин' } },
    ], navigation, { recent_task_uuid: 'task-1' }, deps);

    expect(results[0]).toEqual(expect.objectContaining({ status: 'executed', item_uuid: 'task-1' }));
    expect(deps.upsertTaskCheckbox).toHaveBeenCalledWith(expect.objectContaining({
      uuid: 'cb-new',
      task_uuid: 'task-1',
      text: 'купить аспирин',
    }));
    expect(deps.notifyLocalChange).toHaveBeenCalled();
  });
});
