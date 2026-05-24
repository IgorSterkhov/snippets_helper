import AsyncStorage from '@react-native-async-storage/async-storage';

export const TASK_PREF_KEYS = {
  hideDone: 'tasks.hide_completed_checkboxes',
  wrapText: 'tasks.wrap_checkbox_text',
};

export async function loadTaskPreferences() {
  const [hideDone, wrapText] = await Promise.all([
    AsyncStorage.getItem(TASK_PREF_KEYS.hideDone),
    AsyncStorage.getItem(TASK_PREF_KEYS.wrapText),
  ]);

  return {
    hideDone: hideDone === 'true',
    wrapText: wrapText !== 'false',
  };
}

export async function setTaskPreference(key, value) {
  await AsyncStorage.setItem(key, value ? 'true' : 'false');
}

export async function toggleTaskPreference(key, currentValue) {
  const nextValue = !currentValue;
  await setTaskPreference(key, nextValue);
  return nextValue;
}
