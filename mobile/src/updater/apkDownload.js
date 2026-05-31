import { Linking } from 'react-native';

export const APK_DOWNLOAD_URL = 'https://ister-app.ru/releases/snippets-helper-1.0.0.apk';

export function openApkDownload(linking = Linking, url = APK_DOWNLOAD_URL) {
  return linking.openURL(url || APK_DOWNLOAD_URL);
}
