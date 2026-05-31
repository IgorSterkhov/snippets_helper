import { NativeModules } from 'react-native';
import { APK_DOWNLOAD_URL } from './apkDownload';

export function getNativeApkVersionCode(nativeModules = NativeModules) {
  const raw = nativeModules?.IsterAppInfo?.versionCode;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getApkUpdateInfo(manifest, nativeModules = NativeModules) {
  const nextVersionCode = parseInt(manifest?.apk_version_code, 10);
  if (!Number.isFinite(nextVersionCode) || nextVersionCode <= 0) {
    return null;
  }

  const currentVersionCode = getNativeApkVersionCode(nativeModules);
  if (currentVersionCode >= nextVersionCode) {
    return null;
  }

  return {
    type: 'apk',
    apk_version_code: nextVersionCode,
    apk_url: manifest?.apk_url || APK_DOWNLOAD_URL,
    release_notes: manifest?.apk_release_notes || manifest?.release_notes || '',
  };
}
