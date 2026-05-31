import { startMobileSpeechRecognition, normalizeSpeechTranscript } from '../../src/ai/speechRecognition';

describe('mobile speech recognition helper', () => {
  test('normalizes speech transcript text', () => {
    expect(normalizeSpeechTranscript('  покажи   задачу аптека  ')).toBe('покажи задачу аптека');
  });

  test('starts native recognition after microphone permission is granted', async () => {
    const nativeModule = {
      isAvailable: jest.fn().mockResolvedValue(true),
      start: jest.fn().mockResolvedValue(' добавь аспирин '),
    };
    const permissions = {
      PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
      RESULTS: { GRANTED: 'granted' },
      request: jest.fn().mockResolvedValue('granted'),
    };

    const transcript = await startMobileSpeechRecognition({
      nativeModule,
      permissions,
      platformOS: 'android',
      locale: 'ru-RU',
    });

    expect(transcript).toBe('добавь аспирин');
    expect(permissions.request).toHaveBeenCalledWith('android.permission.RECORD_AUDIO');
    expect(nativeModule.start).toHaveBeenCalledWith('ru-RU');
  });

  test('fails clearly when speech recognition is unavailable', async () => {
    await expect(startMobileSpeechRecognition({
      nativeModule: { isAvailable: jest.fn().mockResolvedValue(false), start: jest.fn() },
      permissions: {},
      platformOS: 'android',
    })).rejects.toThrow('Android speech recognition service is unavailable');
  });

  test('fails clearly when the installed APK does not include the native speech module', async () => {
    await expect(startMobileSpeechRecognition({
      nativeModule: null,
      permissions: {},
      platformOS: 'android',
    })).rejects.toThrow('Install the latest APK from Settings');
  });
});
