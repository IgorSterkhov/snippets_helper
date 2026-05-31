import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const MODULE_NAME = 'IsterSpeechRecognition';
const MISSING_NATIVE_MODULE_MESSAGE = 'Speech recognition native module is not installed. Install the latest APK from Settings and restart the app.';
const UNAVAILABLE_SERVICE_MESSAGE = 'Android speech recognition service is unavailable on this device. Install or enable Google speech services, or use text input.';

export function getSpeechRecognitionModule(nativeModules = NativeModules) {
  return nativeModules?.[MODULE_NAME] || null;
}

export function normalizeSpeechTranscript(value) {
  if (Array.isArray(value)) {
    return normalizeSpeechTranscript(value[0] || '');
  }
  if (value && typeof value === 'object') {
    return normalizeSpeechTranscript(value.transcript || value.text || '');
  }
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function ensureMicrophonePermission(permissions, platformOS) {
  if (platformOS !== 'android') return true;
  if (!permissions?.request || !permissions?.PERMISSIONS?.RECORD_AUDIO) {
    throw new Error('Microphone permission API is not available');
  }
  const result = await permissions.request(permissions.PERMISSIONS.RECORD_AUDIO);
  const granted = permissions.RESULTS?.GRANTED || 'granted';
  if (result !== granted) {
    throw new Error('Microphone permission was not granted');
  }
  return true;
}

export async function startMobileSpeechRecognition({
  nativeModule = getSpeechRecognitionModule(),
  permissions = PermissionsAndroid,
  platformOS = Platform.OS,
  locale = 'ru-RU',
} = {}) {
  if (!nativeModule?.start) {
    throw new Error(MISSING_NATIVE_MODULE_MESSAGE);
  }
  if (nativeModule.isAvailable) {
    const available = await nativeModule.isAvailable();
    if (!available) {
      throw new Error(UNAVAILABLE_SERVICE_MESSAGE);
    }
  }
  await ensureMicrophonePermission(permissions, platformOS);
  const transcript = normalizeSpeechTranscript(await nativeModule.start(locale));
  if (!transcript) {
    throw new Error('Speech recognition returned empty transcript');
  }
  return transcript;
}

export async function stopMobileSpeechRecognition({
  nativeModule = getSpeechRecognitionModule(),
} = {}) {
  if (!nativeModule?.stop) return false;
  await nativeModule.stop();
  return true;
}
