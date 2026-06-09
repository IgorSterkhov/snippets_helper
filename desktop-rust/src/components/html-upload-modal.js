import { call } from '../tauri-api.js';
import { showErrorDialog } from './error-dialog.js';

export function openHtmlUploadModal({ onInsert }) {
  if (document.querySelector('.html-upload-overlay')) return;

  let activeUploadId = null;
  let uploadUnlisten = null;
  let uploaded = null;
  let inserted = false;
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay html-upload-overlay';
  overlay.tabIndex = -1;
  const modal = el('div', 'modal image-upload-modal html-upload-modal');

  const header = el('div', 'image-upload-header');
  header.appendChild(el('h3', '', 'Insert HTML from file'));
  const closeBtn = el('button', 'btn-secondary', 'Close');
  closeBtn.addEventListener('click', cleanup);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const pickerRow = el('div', 'image-upload-picker');
  const fileLabel = el('div', 'image-upload-file', 'No HTML file selected');
  const pickBtn = el('button', '', 'Choose HTML file');
  pickerRow.appendChild(fileLabel);
  pickerRow.appendChild(pickBtn);
  modal.appendChild(pickerRow);

  const guidance = el(
    'div',
    'image-upload-guidance',
    'Single-file UTF-8 HTML is stored as a sandboxed card. External network fetches are blocked by the server CSP.'
  );
  modal.appendChild(guidance);

  const progress = el('div', 'image-upload-progress');
  progress.innerHTML = `
    <div class="image-upload-step" data-step="upload"><span>Upload</span><div><i></i></div><b>0%</b></div>
    <div class="image-upload-step muted" data-step="preview"><span>Preview</span><div><i></i></div><b>waiting</b></div>
  `;
  modal.appendChild(progress);

  const preview = el('div', 'image-upload-preview html-upload-preview');
  preview.appendChild(el('div', 'image-upload-empty', 'Choose an HTML file to preview it in a sandbox.'));
  modal.appendChild(preview);

  const footer = el('div', 'image-upload-footer');
  const insertBtn = el('button', '', 'Insert');
  insertBtn.disabled = true;
  footer.appendChild(insertBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });
  bindUploadProgress();
  setTimeout(() => overlay.focus(), 0);

  pickBtn.addEventListener('click', async () => {
    if (activeUploadId) return;
    pickBtn.disabled = true;
    try {
      const filePath = await call('pick_html_file');
      if (!filePath || closed) {
        pickBtn.disabled = false;
        return;
      }
      fileLabel.textContent = filePath.split(/[\\/]/).pop() || filePath;
      await startUpload(filePath);
    } catch (err) {
      showHtmlError('HTML upload failed', 'The HTML file could not be uploaded.', err);
      if (!closed) pickBtn.disabled = false;
    }
  });

  insertBtn.addEventListener('click', () => {
    if (!uploaded?.markdown) return;
    inserted = true;
    onInsert(uploaded.markdown);
    cleanup();
  });

  async function startUpload(filePath) {
    clearUploadedAsset();
    activeUploadId = createUploadId();
    closeBtn.textContent = 'Cancel';
    setStep('upload', 5, 'starting');
    setStep('preview', 0, 'waiting');
    uploaded = await call('start_html_upload', {
      filePath,
      uploadId: activeUploadId,
    });
    activeUploadId = null;
    if (closed) return;
    setStep('upload', 100, 'done');
    closeBtn.textContent = 'Close';
    renderPreview();
    insertBtn.disabled = !uploaded?.markdown;
    pickBtn.disabled = false;
  }

  function renderPreview() {
    preview.innerHTML = '';
    if (!uploaded?.url) {
      preview.appendChild(el('div', 'image-upload-empty', 'Preview will appear after upload.'));
      return;
    }
    const bar = el('div', 'image-upload-preview-bar');
    bar.appendChild(el('div', 'image-upload-preview-title', `${uploaded.title || 'HTML'} · ${formatBytes(uploaded.size_bytes)}`));
    preview.appendChild(bar);

    const body = el('div', 'image-upload-preview-body html-upload-preview-body');
    const frame = document.createElement('iframe');
    frame.src = uploaded.url;
    frame.title = uploaded.title || 'HTML preview';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.addEventListener('load', () => setStep('preview', 100, 'ready'), { once: true });
    body.appendChild(frame);
    preview.appendChild(body);
    setStep('preview', 35, 'loading');
  }

  async function bindUploadProgress() {
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return;
    try {
      uploadUnlisten = await listen('media-upload-progress', (event) => {
        if (closed || !activeUploadId) return;
        const payload = event?.payload || {};
        if (payload.phase !== 'upload') return;
        const total = Number(payload.bytes_total) || 0;
        const done = Number(payload.bytes_done) || 0;
        const pct = total > 0 ? Math.max(1, Math.min(100, Math.round(done / total * 100))) : 5;
        const label = total > 0
          ? `${formatBytes(done)} / ${formatBytes(total)}`
          : `${pct}%`;
        setStep('upload', payload.finished ? 100 : pct, payload.finished ? 'done' : label);
      });
    } catch {
      uploadUnlisten = null;
    }
  }

  async function cleanup() {
    if (closed) return;
    closed = true;
    if (typeof uploadUnlisten === 'function') uploadUnlisten();
    if (activeUploadId) {
      call('cancel_media_upload', { uploadId: activeUploadId }).catch(() => {});
      activeUploadId = null;
    }
    if (!inserted && uploaded?.asset_uuid) {
      call('delete_media_asset', { assetUuid: uploaded.asset_uuid }).catch(() => {});
    }
    overlay.remove();
  }

  function clearUploadedAsset() {
    if (!inserted && uploaded?.asset_uuid) {
      call('delete_media_asset', { assetUuid: uploaded.asset_uuid }).catch(() => {});
    }
    uploaded = null;
    inserted = false;
    insertBtn.disabled = true;
    preview.innerHTML = '';
    preview.appendChild(el('div', 'image-upload-empty', 'Choose an HTML file to preview it in a sandbox.'));
  }

  function setStep(step, pct, label) {
    const node = progress.querySelector(`[data-step="${step}"]`);
    if (!node) return;
    node.classList.remove('muted');
    node.querySelector('i').style.width = `${pct}%`;
    node.querySelector('b').textContent = label;
  }
}

function showHtmlError(title, message, err) {
  showErrorDialog({
    title,
    message,
    details: {
      title,
      message,
      timestamp: new Date().toISOString(),
      error: String(err?.message || err || ''),
    },
  });
}

function createUploadId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'html-upload-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
