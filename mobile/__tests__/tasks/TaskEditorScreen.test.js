import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TaskEditorScreen from '../../src/screens/Tasks/TaskEditorScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('../../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: '#111111',
      bgSecondary: '#181818',
      bgTertiary: '#222222',
      card: '#1f1f1f',
      border: '#333333',
      text: '#eeeeee',
      textSecondary: '#bbbbbb',
      textMuted: '#888888',
      primary: '#2f81f7',
      primaryLight: '#2f81f733',
      danger: '#f85149',
    },
  }),
}));

jest.mock('../../src/db/taskRepo', () => ({
  deleteTask: jest.fn(),
  flattenCheckboxTree: (items) => items.filter((item) => !item.is_deleted).map((item) => ({
    item,
    depth: 0,
    hasChildren: false,
    hiddenDescendantCount: 0,
  })),
  getCheckboxMoveAvailability: jest.fn(() => ({ up: false, down: false, left: false, right: false })),
  getAllTaskCategories: jest.fn().mockResolvedValue([{ uuid: 'cat-1', name: 'Дом', color: '#99f' }]),
  getAllTaskStatuses: jest.fn().mockResolvedValue([{ uuid: 'status-1', name: 'Open', color: '#9f9' }]),
  getNextTaskSortOrder: jest.fn().mockResolvedValue(1),
  getTaskCheckboxes: jest.fn().mockResolvedValue([
    {
      uuid: 'box-1',
      task_uuid: 'task-1',
      parent_uuid: null,
      text: 'купить монетазон',
      is_checked: 0,
      sort_order: 0,
      is_deleted: 0,
    },
  ]),
  getTaskLinks: jest.fn().mockResolvedValue([{ uuid: 'link-1', task_uuid: 'task-1', url: 'https://x.test', label: 'X', is_deleted: 0 }]),
  moveCheckboxInTree: jest.fn(),
  setTaskCheckboxChecked: jest.fn(),
  upsertTask: jest.fn(),
  upsertTaskCheckbox: jest.fn(),
  upsertTaskLink: jest.fn(),
}));

jest.mock('../../src/sync/syncService', () => ({
  notifyLocalChange: jest.fn(),
}));

jest.mock('../../src/lib/uuid', () => ({
  uuidv4: jest.fn(() => 'uuid-new'),
}));

jest.mock('../../src/screens/Tasks/taskPreferences', () => ({
  TASK_PREF_KEYS: {
    hideDone: 'tasks.hide_completed_checkboxes',
    wrapText: 'tasks.wrap_checkbox_text',
  },
  loadTaskPreferences: jest.fn().mockResolvedValue({ hideDone: false, wrapText: true }),
  toggleTaskPreference: jest.fn().mockResolvedValue(false),
}));

describe('TaskEditorScreen collapsed task mode', () => {
  const task = {
    uuid: 'task-1',
    title: 'Аптека',
    category_uuid: null,
    status_uuid: null,
    is_pinned: 0,
    bg_color: null,
    tracker_url: '',
    notes_md: 'notes',
  };

  function renderScreen(routeParams = {}) {
    const navigation = {
      setOptions: jest.fn(),
      goBack: jest.fn(),
    };
    const view = render(
      <TaskEditorScreen
        route={{ params: { task, isNew: false, ...routeParams } }}
        navigation={navigation}
      />,
    );
    return { ...view, navigation };
  }

  test('hides full task fields when opened collapsed', async () => {
    const view = renderScreen({ collapsed: true });

    await waitFor(() => expect(view.getByDisplayValue('купить монетазон')).toBeTruthy());
    expect(view.getByDisplayValue('Аптека')).toBeTruthy();
    expect(view.queryByText('Категория')).toBeNull();
    expect(view.queryByText('Статус')).toBeNull();
    expect(view.queryByText('Параметры')).toBeNull();
    expect(view.queryByText('Notes')).toBeNull();
    expect(view.queryByText('Ссылки')).toBeNull();
    expect(view.queryByText('Удалить задачу')).toBeNull();
  });

  test('adds a header toggle for task details mode', async () => {
    const { navigation } = renderScreen({ collapsed: true });

    await waitFor(() => expect(navigation.setOptions).toHaveBeenCalled());
    const lastOptions = navigation.setOptions.mock.calls[navigation.setOptions.mock.calls.length - 1][0];
    const header = render(lastOptions.headerRight());

    expect(header.getByLabelText('Развернуть задачу')).toBeTruthy();
  });
});
