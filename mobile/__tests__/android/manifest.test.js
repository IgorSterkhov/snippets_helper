const fs = require('fs');
const path = require('path');

describe('Android manifest native capabilities', () => {
  const manifestPath = path.join(__dirname, '../../android/app/src/main/AndroidManifest.xml');
  const manifest = fs.readFileSync(manifestPath, 'utf8');

  test('declares speech recognition service visibility for Android 11+', () => {
    expect(manifest).toContain('<queries>');
    expect(manifest).toContain('android.speech.RecognitionService');
  });
});
