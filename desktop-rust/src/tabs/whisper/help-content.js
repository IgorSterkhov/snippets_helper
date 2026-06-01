// Help content for the Whisper tab. Rendered inside the shared help modal
// (`sql-help.js`) via the `?` button in the tab header.

export const WHISPER_HELP_HTML = `
<p>
  <strong>Whisper</strong> — модуль голосового ввода. Он умеет работать в двух
  режимах: локальная запись через установленную whisper.cpp-модель и
  <strong>Live dictate</strong>, где аудио потоково отправляется в облачный
  провайдер и готовые фрагменты вставляются в активное окно.
</p>

<h4>Быстрый выбор режима</h4>
<ul>
  <li><strong>Local Whisper</strong> — нажмите <em>Record</em>, говорите,
      нажмите <em>Stop</em>. Распознавание идет локально выбранной моделью
      Whisper. Чем больше модель, тем выше качество и тем больше нагрузка.</li>
  <li><strong>Live dictate</strong> — включите checkbox в header, выберите
      <em>Deepgram</em> или <em>Yandex SpeechKit</em>, затем нажмите
      <em>Start live</em>. Финальные фразы будут вставляться в активное окно.</li>
  <li><strong>AI tab voice</strong> использует те же локальные настройки
      Whisper/Deepgram/Yandex, но вставляет остановленный transcript в prompt
      AI Agent.</li>
</ul>

<h4>Deepgram: где взять API key</h4>
<ol>
  <li>Откройте <code>https://console.deepgram.com</code> и войдите в аккаунт.</li>
  <li>Выберите проект через project selector.</li>
  <li>Откройте раздел <strong>API Keys</strong> и создайте
      <strong>Project API Key</strong>.</li>
  <li>Скопируйте ключ в <strong>Settings &gt; Whisper &gt; Deepgram API Key</strong>.</li>
  <li>Для русской речи используйте модель Nova и включенные punctuation /
      smart formatting, если эти параметры доступны в настройках.</li>
</ol>

<h4>Yandex SpeechKit: где взять API key</h4>
<ol>
  <li>Откройте <code>https://console.yandex.cloud</code> или
      <code>https://aistudio.yandex.ru</code>.</li>
  <li>Создайте или выберите cloud/folder с включенным billing.</li>
  <li>Создайте <strong>service account</strong> для приложения.</li>
  <li>Выдайте service account роль <code>ai.speechkit-stt.user</code>.</li>
  <li>Создайте API key для этого service account.</li>
  <li>Сохраните именно <strong>secret value</strong> ключа. Обычно он выглядит
      как <code>AQVN...</code>. Не вставляйте <strong>key ID</strong> вида
      <code>aje...</code>: по нему SpeechKit вернет ошибку
      <code>Unknown api key</code>.</li>
  <li>Скопируйте ключ в <strong>Settings &gt; Whisper &gt; Yandex SpeechKit</strong>.</li>
  <li>Для русской диктовки начните с language <code>ru-RU</code> и включенной
      text normalization.</li>
</ol>

<h4>Безопасность ключей</h4>
<ul>
  <li>Ключи Deepgram и Yandex хранятся локально в настройках desktop app.</li>
  <li>Они не синхронизируются между устройствами и не отправляются на sync API.</li>
  <li>Ключ используется только когда включен <strong>Live dictate</strong> и
      выбран соответствующий провайдер.</li>
</ul>

<h4>Если live-диктовка не работает</h4>
<ul>
  <li>Проверьте, что ключ сохранен в <strong>Settings &gt; Whisper</strong>.</li>
  <li>Проверьте billing/квоты в кабинете провайдера.</li>
  <li>Для Yandex проверьте роль service account:
      <code>ai.speechkit-stt.user</code>.</li>
  <li>Если ошибка содержит <code>Unknown api key 'aje...'</code>, в Settings
      вставлен идентификатор ключа. Создайте новый API key и вставьте его
      <strong>secret value</strong>, потому что после закрытия окна создания
      Yandex больше не показывает secret повторно.</li>
  <li>Ошибки Whisper/cloud provider открываются постоянной модалкой с
      кнопкой <strong>Copy error</strong>. Этот текст лучше копировать целиком
      при разборе проблемы.</li>
</ul>
`;
