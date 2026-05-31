jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('react-native-ota-hot-update', () => ({
  downloadBundleUri: jest.fn(),
}));

jest.mock('react-native-blob-util', () => ({}));

import { selectAvailableUpdate } from '../../src/updater/updateService';

describe('mobile update selection', () => {
  test('prioritizes a newer OTA bundle before APK prompt', () => {
    const selected = selectAvailableUpdate({
      version: '1.0.22',
      bundle_url: 'https://ister-app.ru/snippets-updates/bundle-1.0.22.zip',
      apk_required_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
    }, '1.0.21', {});

    expect(selected).toEqual(expect.objectContaining({
      version: '1.0.22',
      bundle_url: 'https://ister-app.ru/snippets-updates/bundle-1.0.22.zip',
    }));
  });

  test('returns APK prompt after OTA is already current', () => {
    const selected = selectAvailableUpdate({
      version: '1.0.22',
      bundle_url: 'https://ister-app.ru/snippets-updates/bundle-1.0.22.zip',
      apk_required_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
    }, '1.0.22', {});

    expect(selected).toEqual(expect.objectContaining({
      type: 'apk',
      apk_version_code: 4,
      apk_url: 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk',
    }));
  });
});
