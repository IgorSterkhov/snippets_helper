import { NativeModules } from 'react-native';
import { APK_DOWNLOAD_URL } from './apkDownload';

export function getNativeApkVersionCode(nativeModules = NativeModules) {
  const raw = nativeModules?.IsterAppInfo?.versionCode;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getApkVersionStatus(manifest, nativeModules = NativeModules) {
  const nextVersionCode = parseInt(manifest?.apk_version_code || manifest?.apk_required_version_code, 10);
  const latestVersionCode = Number.isFinite(nextVersionCode) && nextVersionCode > 0 ? nextVersionCode : 0;
  const currentVersionCode = getNativeApkVersionCode(nativeModules);
  return {
    currentVersionCode,
    latestVersionCode,
    needsUpdate: latestVersionCode > 0 && currentVersionCode < latestVersionCode,
    apkUrl: manifest?.apk_url || APK_DOWNLOAD_URL,
    releaseNotes: manifest?.apk_release_notes || manifest?.release_notes || '',
  };
}

export function getApkUpdateInfo(manifest, nativeModules = NativeModules) {
  const status = getApkVersionStatus(manifest, nativeModules);
  const nextVersionCode = status.latestVersionCode;
  if (!Number.isFinite(nextVersionCode) || nextVersionCode <= 0) {
    return null;
  }

  if (!status.needsUpdate) {
    return null;
  }

  return {
    type: 'apk',
    apk_version_code: nextVersionCode,
    apk_url: status.apkUrl,
    release_notes: status.releaseNotes,
  };
}
