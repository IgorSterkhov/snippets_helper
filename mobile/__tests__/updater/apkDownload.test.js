import { APK_DOWNLOAD_URL, openApkDownload } from '../../src/updater/apkDownload';

describe('APK download helper', () => {
  test('opens the pinned public APK URL', async () => {
    const linking = { openURL: jest.fn().mockResolvedValue(undefined) };

    await openApkDownload(linking);

    expect(APK_DOWNLOAD_URL).toBe('https://ister-app.ru/releases/snippets-helper-1.0.0.apk');
    expect(linking.openURL).toHaveBeenCalledWith(APK_DOWNLOAD_URL);
  });
});
