import {
  getApkVersionStatus,
  getApkUpdateInfo,
  getNativeApkVersionCode,
} from '../../src/updater/apkVersion';

describe('APK version checks', () => {
  test('treats APK as outdated when app info native module is missing', () => {
    expect(getNativeApkVersionCode({})).toBe(0);

    const update = getApkUpdateInfo({
      apk_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
      apk_release_notes: 'AI voice support requires a new APK.',
    }, {});

    expect(update).toEqual({
      type: 'apk',
      apk_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
      release_notes: 'AI voice support requires a new APK.',
    });
  });

  test('does not require APK update when native versionCode is current', () => {
    const update = getApkUpdateInfo({
      apk_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
    }, {
      IsterAppInfo: { versionCode: 4 },
    });

    expect(update).toBeNull();
  });

  test('returns readable installed and latest APK version status', () => {
    expect(getApkVersionStatus({
      apk_required_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
    }, {
      IsterAppInfo: { versionCode: 3 },
    })).toEqual({
      currentVersionCode: 3,
      latestVersionCode: 4,
      needsUpdate: true,
      apkUrl: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
      releaseNotes: '',
    });

    expect(getApkVersionStatus({
      apk_version_code: 4,
    }, {
      IsterAppInfo: { versionCode: 4 },
    })).toEqual(expect.objectContaining({
      currentVersionCode: 4,
      latestVersionCode: 4,
      needsUpdate: false,
    }));
  });
});
