import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  TASK_PREF_KEYS,
  loadTaskPreferences,
  setTaskPreference,
} from '../../src/screens/Tasks/taskPreferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('taskPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadTaskPreferences returns defaults when storage is empty', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);

    await expect(loadTaskPreferences()).resolves.toEqual({
      hideDone: false,
      wrapText: true,
    });
  });

  test('loadTaskPreferences parses stored booleans', async () => {
    AsyncStorage.getItem.mockImplementation((key) => {
      if (key === TASK_PREF_KEYS.hideDone) return Promise.resolve('true');
      if (key === TASK_PREF_KEYS.wrapText) return Promise.resolve('false');
      return Promise.resolve(null);
    });

    await expect(loadTaskPreferences()).resolves.toEqual({
      hideDone: true,
      wrapText: false,
    });
  });

  test('setTaskPreference stores booleans as strings', async () => {
    AsyncStorage.setItem.mockResolvedValue(undefined);

    await setTaskPreference(TASK_PREF_KEYS.hideDone, true);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(TASK_PREF_KEYS.hideDone, 'true');
  });
});
