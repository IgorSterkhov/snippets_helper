import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let updateInfo = null;
let onProgressCallback = null;

async function getUpdateUrl() {
  const apiUrl = await AsyncStorage.getItem('api_base_url') || '';
  if (!apiUrl) return '';
  // Derive updates URL from API base: https://host/snippets-api -> https://host/snippets-updates/latest.json
  const base = apiUrl.replace(/\/snippets-api\/?$/, '');
  return base + '/snippets-updates/latest.json';
}

export async function checkForUpdate(showAlertIfNone = false) {
  try {
    const updateUrl = await getUpdateUrl();
    if (!updateUrl) {
      if (showAlertIfNone) Alert.alert('Ошибка', 'API URL не настроен');
      return null;
    }

    const response = await fetch(updateUrl);
    const data = await response.json();
    const currentVersion = '1.0.0';

    if (data.version && data.version !== currentVersion) {
      updateInfo = data;
      return data;
    }

    if (showAlertIfNone) {
      Alert.alert('Обновления', 'У вас последняя версия');
    }
    return null;
  } catch (e) {
    if (showAlertIfNone) {
      Alert.alert('Ошибка', 'Не удалось проверить обновления');
    }
    return null;
  }
}

export function getUpdateInfo() {
  return updateInfo;
}

export function setOnProgress(callback) {
  onProgressCallback = callback;
}

export async function applyUpdate() {
  if (!updateInfo) return;
  try {
    const { HotUpdate } = require('react-native-ota-hot-update');
    HotUpdate.downloadBundleUri(updateInfo.bundle_url, {
      updateType: HotUpdate.UpdateType.IMMEDIATE,
      progress: (received, total) => {
        if (onProgressCallback) {
          onProgressCallback(received / total);
        }
      },
    });
  } catch (e) {
    Alert.alert('Ошибка', 'Не удалось применить обновление');
  }
}
