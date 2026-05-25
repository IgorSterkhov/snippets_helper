import { call } from '../tauri-api.js';
import { showToast } from './toast.js';

const PRESETS = ['small', 'balanced', 'readable', 'original'];

export function openImageUploadModal({ onInsert }) {
  if (document.querySelector('.image-upload-overlay')) return;

  let selectedVariant = 'balanced';
  let currentJob = null;
  let readyJob = null;
  let activeUploadId = null;
  let pollTimer = null;
  let processingTimer = null;
  let uploadUnlisten = null;
  let inserted = false;
  let closed = false;
  let previewRunId = 0;

  const loadedPreviews = new Set();
  const failedPreviews = new Set();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay image-upload-overlay';
  const modal = el('div', 'modal image-upload-modal');

  const header = el('div', 'image-upload-header');
  header.appendChild(el('h3', '', 'Insert image'));
  const closeBtn = el('button', 'btn-secondary', 'Close');
  closeBtn.addEventListener('click', () => {
    if (activeUploadId) {
      cancelActiveUpload();
      return;
    }
    cleanup();
  });
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const pickerRow = el('div', 'image-upload-picker');
  const fileLabel = el('div', 'image-upload-file', 'No image selected');
  const pickBtn = el('button', '', 'Choose image');
  pickerRow.appendChild(fileLabel);
  pickerRow.appendChild(pickBtn);
  modal.appendChild(pickerRow);

  const presetRow = el('div', 'image-upload-presets');
  const presetButtons = new Map();
  for (const preset of PRESETS) {
    const btn = el('button', 'btn-secondary' + (preset === selectedVariant ? ' active' : ''), labelPreset(preset));
    btn.disabled = true;
    btn.addEventListener('click', () => {
      if (!loadedPreviews.has(preset)) return;
      selectedVariant = preset;
      updatePresetButtons();
      renderPreview();
      updateInsertState();
    });
    presetButtons.set(preset, btn);
    presetRow.appendChild(btn);
  }
  modal.appendChild(presetRow);

  const guidance = el(
    'div',
    'image-upload-guidance',
    'Balanced is the default. Use Readable for text-heavy images, or Original if optimization loses detail.'
  );
  modal.appendChild(guidance);

  const progress = el('div', 'image-upload-progress');
  progress.innerHTML = `
    <div class="image-upload-step" data-step="upload"><span>Upload</span><div><i></i></div><b>0%</b></div>
    <div class="image-upload-step muted" data-step="processing"><span>Processing</span><div><i></i></div><b>waiting</b></div>
    <div class="image-upload-step muted" data-step="preview"><span>Preview</span><div><i></i></div><b>waiting</b></div>
  `;
  modal.appendChild(progress);

  const preview = el('div', 'image-upload-preview');
  preview.appendChild(el('div', 'image-upload-empty', 'Choose an image to generate optimized variants.'));
  modal.appendChild(preview);

  const footer = el('div', 'image-upload-footer');
  const insertBtn = el('button', '', 'Insert');
  insertBtn.disabled = true;
  footer.appendChild(insertBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay || closeBtn.disabled) return;
    if (activeUploadId) {
      cancelActiveUpload();
      return;
    }
    cleanup();
  });
  bindUploadProgress();
  updateCloseState();

  pickBtn.addEventListener('click', async () => {
    pickBtn.disabled = true;
    clearReadyAsset();
    try {
      const filePath = await call('pick_media_file');
      if (!filePath || closed) return;
      fileLabel.textContent = filePath.split(/[\\/]/).pop() || filePath;
      activeUploadId = createUploadId();
      updateCloseState();
      setStep('upload', 5, 'starting');
      const upload = await call('start_media_upload', {
        filePath,
        uploadId: activeUploadId,
      });
      if (closed) return;
      activeUploadId = null;
      currentJob = upload.job_id;
      setStep('upload', 100, 'done');
      updateCloseState();
      processingTimer = setTimeout(() => {
        setStep('processing', 25, 'processing');
      }, 1000);
      pollJob();
    } catch (err) {
      activeUploadId = null;
      currentJob = null;
      if (closed) return;
      const message = String(err || '');
      if (message.includes('upload cancelled')) {
        setStep('upload', 0, 'cancelled');
      } else {
        showToast('Image upload failed: ' + err, 'error');
        setStep('upload', 0, 'failed');
      }
    } finally {
      if (!closed) {
        pickBtn.disabled = false;
        updateCloseState();
      }
    }
  });

  insertBtn.addEventListener('click', async () => {
    if (!readyJob?.asset_uuid || !loadedPreviews.has(selectedVariant)) return;
    insertBtn.disabled = true;
    try {
      const selected = await call('select_media_variant', {
        assetUuid: readyJob.asset_uuid,
        variant: selectedVariant,
      });
      inserted = true;
      onInsert(selected.markdown);
      cleanup();
    } catch (err) {
      showToast('Failed to insert image: ' + err, 'error');
      updateInsertState();
    }
  });

  async function pollJob() {
    if (!currentJob || closed) return;
    try {
      const job = await call('get_media_job', { jobId: currentJob });
      if (closed) return;
      if (job.status === 'failed') {
        clearTimeout(processingTimer);
        currentJob = null;
        updateCloseState();
        setStep('processing', 100, 'failed');
        showToast(job.error || 'Image processing failed', 'error');
        return;
      }
      if (job.status === 'ready') {
        clearTimeout(processingTimer);
        readyJob = job;
        setStep('processing', 100, 'done');
        updateCloseState();
        startPreviewLoading(job.variants || []);
        return;
      }
      const total = job.progress_total || 4;
      const pct = Math.max(10, Math.min(90, Math.round((job.progress_current || 1) / total * 100)));
      setStep('processing', pct, `${job.progress_current || 1} / ${total}`);
      pollTimer = setTimeout(pollJob, 500);
    } catch (err) {
      if (!closed) showToast('Image job polling failed: ' + err, 'error');
    }
  }

  function startPreviewLoading(variants) {
    loadedPreviews.clear();
    failedPreviews.clear();
    updatePresetButtons();
    updateInsertState();

    const runId = ++previewRunId;
    const total = variants.length;
    if (!total) {
      setStep('preview', 100, 'failed');
      renderPreview();
      return;
    }

    let done = 0;
    setStep('preview', 0, `0 / ${total}`);
    renderPreview();

    for (const variant of variants) {
      preloadImage(variant.preview_url)
        .then(() => loadedPreviews.add(variant.variant))
        .catch(() => failedPreviews.add(variant.variant))
        .finally(() => {
          if (closed || runId !== previewRunId) return;
          done += 1;
          const pct = Math.round(done / total * 100);
          setStep('preview', pct, `${done} / ${total}`);

          if (!loadedPreviews.has(selectedVariant)) {
            const next = variants.find(v => loadedPreviews.has(v.variant));
            if (next) selectedVariant = next.variant;
          }

          updatePresetButtons();
          renderPreview();
          updateInsertState();

          if (done === total) {
            if (loadedPreviews.size === 0) {
              setStep('preview', 100, 'failed');
              showToast('Image previews failed to load', 'error');
            } else {
              setStep('preview', 100, `${loadedPreviews.size} / ${total}`);
            }
          }
        });
    }
  }

  function renderPreview() {
    preview.innerHTML = '';
    const variant = readyJob?.variants?.find(v => v.variant === selectedVariant);
    if (!variant) {
      preview.appendChild(el('div', 'image-upload-empty', 'Preview will appear after processing.'));
      return;
    }
    if (failedPreviews.has(selectedVariant)) {
      preview.appendChild(el('div', 'image-upload-empty', 'Preview failed for this variant.'));
      return;
    }
    if (!loadedPreviews.has(selectedVariant)) {
      preview.appendChild(el('div', 'image-upload-empty', 'Loading optimized preview...'));
      return;
    }

    const img = document.createElement('img');
    img.src = variant.preview_url;
    img.alt = selectedVariant;
    img.addEventListener('click', () => openFullPreview(variant));
    preview.appendChild(img);
    preview.appendChild(el(
      'div',
      'image-upload-meta',
      `${labelPreset(selectedVariant)} · selected ${formatBytes(variant.size_bytes)} · stored ${formatBytes(assetTotalBytes())} · ${variant.width}x${variant.height}`
    ));
  }

  function setStep(step, pct, label) {
    const node = progress.querySelector(`[data-step="${step}"]`);
    if (!node) return;
    node.classList.remove('muted');
    node.querySelector('i').style.width = `${pct}%`;
    node.querySelector('b').textContent = label;
  }

  async function bindUploadProgress() {
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return;
    try {
      uploadUnlisten = await listen('media-upload-progress', (event) => {
        if (closed) return;
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

  async function cancelActiveUpload() {
    const uploadId = activeUploadId;
    activeUploadId = null;
    updateCloseState();
    if (uploadId) {
      try {
        await call('cancel_media_upload', { uploadId });
      } catch {}
    }
    setStep('upload', 0, 'cancelled');
    cleanup();
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (processingTimer) clearTimeout(processingTimer);
    if (typeof uploadUnlisten === 'function') uploadUnlisten();
    if (activeUploadId) {
      call('cancel_media_upload', { uploadId: activeUploadId }).catch(() => {});
      activeUploadId = null;
    }
    if (!inserted && readyJob?.asset_uuid) {
      call('delete_media_asset', { assetUuid: readyJob.asset_uuid }).catch(() => {});
    }
    overlay.remove();
  }

  function clearReadyAsset() {
    if (!inserted && readyJob?.asset_uuid) {
      call('delete_media_asset', { assetUuid: readyJob.asset_uuid }).catch(() => {});
    }
    currentJob = null;
    readyJob = null;
    loadedPreviews.clear();
    failedPreviews.clear();
    previewRunId += 1;
    inserted = false;
    for (const btn of presetButtons.values()) btn.disabled = true;
    updateInsertState();
  }

  function updateCloseState() {
    if (activeUploadId) {
      closeBtn.disabled = false;
      closeBtn.textContent = 'Cancel';
      return;
    }
    if (currentJob && !readyJob) {
      closeBtn.disabled = true;
      closeBtn.textContent = 'Processing...';
      return;
    }
    closeBtn.disabled = false;
    closeBtn.textContent = 'Close';
  }

  function updatePresetButtons() {
    presetButtons.forEach((btn, preset) => {
      btn.disabled = !loadedPreviews.has(preset);
      btn.classList.toggle('active', preset === selectedVariant);
    });
  }

  function updateInsertState() {
    insertBtn.disabled = !readyJob?.asset_uuid || !loadedPreviews.has(selectedVariant);
  }

  function assetTotalBytes() {
    return (readyJob?.variants || []).reduce((sum, variant) => sum + (Number(variant.size_bytes) || 0), 0);
  }
}

function openFullPreview(variant) {
  const overlay = el('div', 'modal-overlay image-full-preview');
  const img = document.createElement('img');
  img.src = variant.preview_url;
  img.alt = variant.variant;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('preview failed'));
    img.src = url;
  });
}

function createUploadId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'upload-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function labelPreset(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
