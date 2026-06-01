const fs = require('fs');
const path = require('path');

describe('Android speech recognition native module', () => {
  const modulePath = path.join(
    __dirname,
    '../../android/app/src/main/java/com/snippetshelper/IsterSpeechRecognitionModule.kt',
  );
  const source = fs.readFileSync(modulePath, 'utf8');

  test('rejects SpeechRecognizer startup exceptions instead of crashing the UI thread', () => {
    expect(source).toContain('reactContext.runOnUiQueueThread');
    expect(source).toContain('catch (e: Throwable)');
    expect(source).toContain('speech_start_failed');
  });

  test('tries explicit recognition services before falling back to the system default', () => {
    expect(source).toContain('RecognitionService.SERVICE_INTERFACE');
    expect(source).toContain('recognitionServiceCandidates');
    expect(source).toContain('SpeechRecognizer.createSpeechRecognizer(reactContext, componentName)');
    expect(source).toContain('com.google.android.googlequicksearchbox');
  });
});
