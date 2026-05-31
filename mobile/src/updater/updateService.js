import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import hotUpdate from 'react-native-ota-hot-update';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { version as BUNDLED_VERSION } from '../../package.json';
import { getApkUpdateInfo, getApkVersionStatus } from './apkVersion';

const OTA_VERSION_KEY = 'installed_ota_version';

let updateInfo = null;
let progressCallback = null;

// Parse "1.0.0" → [1, 0, 0]. Non-numeric parts become 0.
function parseVersion(v) {
  return String(v || '0').split('.').map((p) => parseInt(p, 10) || 0);
}

// Compare semver: > 0 if a > b, < 0 if a < b, 0 if equal.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function getInstalledVersion() {
  const stored = await AsyncStorage.getItem(OTA_VERSION_KEY);
  if (stored && compareVersions(stored, BUNDLED_VERSION) > 0) {
    return stored;
  }
  return BUNDLED_VERSION;
}

async function getUpdateUrl() {
  const apiUrl = await AsyncStorage.getItem('api_base_url') || '';
  if (!apiUrl) return '';
  const base = apiUrl.replace(/\/+$/, '').replace(/\/snippets-api$/, '');
  return base + '/snippets-updates/latest.json';
}

async function fetchUpdateManifest(updateUrl) {
  const response = await fetch(updateUrl, { cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.responseText = text;
    throw error;
  }
  return JSON.parse(text);
}

export function selectAvailableUpdate(data, installed, nativeModules) {
  if (data?.version && compareVersions(data.version, installed) > 0) {
    return data;
  }
  return getApkUpdateInfo(data, nativeModules);
}

export async function loadApkVersionStatus() {
  const updateUrl = await getUpdateUrl();
  if (!updateUrl) {
    return {
      ...getApkVersionStatus(null),
      error: 'API URL не настроен',
    };
  }
  try {
    const data = await fetchUpdateManifest(updateUrl);
    return getApkVersionStatus(data);
  } catch (e) {
    return {
      ...getApkVersionStatus(null),
      error: String(e?.message || e),
    };
  }
}

export async function checkForUpdate(showAlertIfNone = false) {
  let updateUrl = '';
  try {
    updateUrl = await getUpdateUrl();
    if (!updateUrl) {
      if (showAlertIfNone) Alert.alert('Ошибка', 'API URL не настроен');
      return null;
    }

    let data;
    try {
      data = await fetchUpdateManifest(updateUrl);
    } catch (e) {
      if (showAlertIfNone) {
        Alert.alert('Ошибка', `URL: ${updateUrl}\n${String(e?.message || e)}`);
      }
      return null;
    }

    if (!data.version) {
      const apkUpdate = getApkUpdateInfo(data);
      if (apkUpdate) {
        updateInfo = apkUpdate;
        return apkUpdate;
      }
      if (showAlertIfNone) {
        Alert.alert('Ошибка', `Нет поля version в ответе:\n${JSON.stringify(data).slice(0, 200)}`);
      }
      return null;
    }

    const installed = await getInstalledVersion();
    const selectedUpdate = selectAvailableUpdate(data, installed);
    if (selectedUpdate) {
      updateInfo = selectedUpdate;
      return selectedUpdate;
    }

    if (showAlertIfNone) {
      Alert.alert(
        'Обновления',
        `У вас последняя версия\nУстановлено: ${installed}\nНа сервере: ${data.version}`,
      );
    }
    return null;
  } catch (e) {
    if (showAlertIfNone) {
      Alert.alert('Сеть недоступна', `URL: ${updateUrl}\n${String(e)}`);
    }
    return null;
  }
}

export function getUpdateInfo() {
  return updateInfo;
}

export function setOnProgress(callback) {
  progressCallback = callback;
}

// Compute a numeric OTA bundle version for the native layer.
// Native layer stores only integers, so we derive one from semver by
// packing MAJOR*1_000_000 + MINOR*1_000 + PATCH.
function semverToInt(semver) {
  const [maj = 0, min = 0, patch = 0] = parseVersion(semver);
  return maj * 1_000_000 + min * 1_000 + patch;
}

export async function applyUpdate() {
  const info = updateInfo;
  if (!info) return;
  if (info.type === 'apk') return false;

  const numericVersion = semverToInt(info.version);

  return new Promise((resolve) => {
    hotUpdate.downloadBundleUri(
      ReactNativeBlobUtil,
      info.bundle_url,
      numericVersion,
      {
        restartAfterInstall: true,
        restartDelay: 500,
        extensionBundle: '.bundle',
        progress: (received, total) => {
          if (progressCallback) {
            const r = parseInt(received, 10) || 0;
            const t = parseInt(total, 10) || 1;
            progressCallback(r / t);
          }
        },
        updateSuccess: async () => {
          await AsyncStorage.setItem(OTA_VERSION_KEY, info.version);
          resolve(true);
        },
        updateFail: (msg) => {
          Alert.alert('Ошибка обновления', String(msg || 'unknown'));
          resolve(false);
        },
      },
    );
  });
}
