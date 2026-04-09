import { Alert } from 'react-native';

const UPDATE_URL = 'http://109.172.85.124:8000/updates/latest.json';

let updateInfo = null;
let onProgressCallback = null;

export async function checkForUpdate(showAlertIfNone = false) {
  try {
    const response = await fetch(UPDATE_URL);
    const data = await response.json();
    // Compare with current bundled version
    const currentVersion = '1.0.0'; // Will be read from package.json or config

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
