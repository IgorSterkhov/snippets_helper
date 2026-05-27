import { call } from '../tauri-api.js';
import { showErrorDialog } from './error-dialog.js';

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
  const failedPreviews = new Map();
  const previewSources = new Map();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay image-upload-overlay';
  overlay.tabIndex = -1;
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
  const pasteBtn = el('button', 'btn-secondary', 'Paste from clipboard');
  pickerRow.appendChild(fileLabel);
  pickerRow.appendChild(pickBtn);
  pickerRow.appendChild(pasteBtn);
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
  document.addEventListener('keydown', onKeyDown);
  bindUploadProgress();
  updateCloseState();
  setTimeout(() => overlay.focus(), 0);

  pickBtn.addEventListener('click', async () => {
    if (isUploadBusy()) return;
    pickBtn.disabled = true;
    pasteBtn.disabled = true;
    try {
      const filePath = await call('pick_media_file');
      if (!filePath || closed) return;
      await startUpload({
        label: filePath.split(/[\\/]/).pop() || filePath,
        command: 'start_media_upload',
        args: { filePath },
      });
    } catch (err) {
      handleUploadError(err);
    } finally {
      if (!closed) {
        updateCloseState();
      }
    }
  });

  pasteBtn.addEventListener('click', () => {
    startClipboardUpload();
  });

  document.addEventListener('paste', onPaste);

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
      showImageError(
        'Image insert failed',
        'The optimized image was generated, but the desktop app could not insert it into the editor.',
        err,
        { stage: 'insert' }
      );
      updateInsertState();
    }
  });

  async function startClipboardUpload() {
    if (isUploadBusy()) return;
    try {
      await startUpload({
        label: 'Clipboard screenshot',
        command: 'start_media_clipboard_upload',
        args: {},
      });
    } catch (err) {
      handleUploadError(err);
    }
  }

  function onPaste(e) {
    if (closed || isUploadBusy()) return;
    e.preventDefault();
    startClipboardUpload();
  }

  async function startUpload({ label, command, args }) {
    clearReadyAsset();
    fileLabel.textContent = label;
    activeUploadId = createUploadId();
    updateCloseState();
    setStep('upload', 5, 'starting');
    const upload = await call(command, {
      ...args,
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
  }

  function handleUploadError(err) {
    const uploadId = activeUploadId;
    activeUploadId = null;
    currentJob = null;
    if (closed) return;
    const message = String(err || '');
    if (message.includes('upload cancelled')) {
      setStep('upload', 0, 'cancelled');
    } else {
      showImageError(
        'Image upload failed',
        'The image could not be sent to the server.',
        err,
        { stage: 'upload', upload_id: uploadId }
      );
      setStep('upload', 0, 'failed');
    }
    updateCloseState();
  }

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
        showImageError(
          'Image processing failed',
          job.error || 'The server could not prepare optimized image variants.',
          job.error || 'job status failed',
          { stage: 'processing', job }
        );
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
      if (!closed) {
        currentJob = null;
        updateCloseState();
        setStep('processing', 100, 'failed');
        showImageError(
          'Image processing status failed',
          'The desktop app could not read the server image-processing status.',
          err,
          { stage: 'processing_poll' }
        );
      }
    }
  }

  function startPreviewLoading(variants) {
    loadedPreviews.clear();
    failedPreviews.clear();
    previewSources.clear();
    updatePresetButtons();
    updateInsertState();

    const runId = ++previewRunId;
    const total = variants.length;
    if (!total) {
      setStep('preview', 100, 'failed');
      renderPreview();
      showImageError(
        'Image preview failed',
        'The server processed the image, but did not return any preview variants.',
        'no variants returned',
        { stage: 'preview', total_variants: 0 }
      );
      return;
    }

    let done = 0;
    setStep('preview', 0, `0 / ${total}`);
    renderPreview();

    for (const variant of variants) {
      loadPreviewVariant(variant)
        .then((src) => {
          loadedPreviews.add(variant.variant);
          previewSources.set(variant.variant, src);
        })
        .catch((err) => failedPreviews.set(variant.variant, {
          preview_url: variant.preview_url,
          reason: String(err?.message || err),
        }))
        .finally(() => {
          if (closed || runId !== previewRunId) return;
          done += 1;
          const pct = Math.round(done / total * 100);
          setStep('preview', pct, `${done} / ${total}`);

          updatePresetButtons();
          renderPreview();
          updateInsertState();

          if (done === total) {
            if (!loadedPreviews.has(selectedVariant)) {
              const next = variants.find(v => loadedPreviews.has(v.variant));
              if (next) selectedVariant = next.variant;
            }
            updatePresetButtons();
            renderPreview();
            updateInsertState();

            if (loadedPreviews.size === 0) {
              setStep('preview', 100, 'failed');
              showImageError(
                'Image preview failed',
                'The server processed the image, but the desktop app could not load any generated preview.',
                'all preview variants failed to load',
                { stage: 'preview', total_variants: total }
              );
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

    preview.appendChild(renderPreviewHeader(variant));
    const body = el('div', 'image-upload-preview-body');
    preview.appendChild(body);

    if (failedPreviews.has(selectedVariant)) {
      const failure = failedPreviews.get(selectedVariant);
      body.appendChild(el('div', 'image-upload-empty', failure?.reason || 'Preview failed for this variant.'));
      return;
    }
    if (!loadedPreviews.has(selectedVariant)) {
      body.appendChild(el('div', 'image-upload-empty', 'Loading optimized preview...'));
      return;
    }

    const img = document.createElement('img');
    img.src = previewSources.get(selectedVariant) || variant.preview_url;
    img.alt = selectedVariant;
    img.addEventListener('click', () => openFullPreview(variant, img.src));
    body.appendChild(img);
    body.appendChild(el(
      'div',
      'image-upload-meta',
      `${labelPreset(selectedVariant)} · selected ${formatBytes(variant.size_bytes)} · stored ${formatBytes(assetTotalBytes())} · ${variant.width}x${variant.height}`
    ));
  }

  function renderPreviewHeader(variant) {
    const bar = el('div', 'image-upload-preview-bar');
    const title = el('div', 'image-upload-preview-title', previewTitle(variant));
    const nav = el('div', 'image-upload-preview-navs');
    const prev = el('button', 'btn-secondary image-upload-preview-nav image-upload-preview-prev', '<');
    const next = el('button', 'btn-secondary image-upload-preview-nav image-upload-preview-next', '>');
    const canMove = availablePreviewVariants().length > 1;
    prev.title = 'Previous variant';
    next.title = 'Next variant';
    prev.disabled = !canMove;
    next.disabled = !canMove;
    prev.addEventListener('click', () => switchPreviewVariant(-1));
    next.addEventListener('click', () => switchPreviewVariant(1));
    nav.appendChild(prev);
    nav.appendChild(next);
    bar.appendChild(title);
    bar.appendChild(nav);
    return bar;
  }

  function previewTitle(variant) {
    const index = PRESETS.indexOf(variant.variant);
    const position = index >= 0 ? index + 1 : 1;
    const total = readyJob?.variants?.length || PRESETS.length;
    return `${labelPreset(variant.variant)} preview · ${position} / ${total}`;
  }

  function availablePreviewVariants() {
    const variants = readyJob?.variants || [];
    return PRESETS
      .map(name => variants.find(v => v.variant === name))
      .filter(variant => variant && loadedPreviews.has(variant.variant));
  }

  function switchPreviewVariant(direction) {
    const variants = availablePreviewVariants();
    if (variants.length < 2) return;
    const current = variants.findIndex(v => v.variant === selectedVariant);
    const start = current >= 0 ? current : 0;
    const next = variants[(start + direction + variants.length) % variants.length];
    selectedVariant = next.variant;
    updatePresetButtons();
    renderPreview();
    updateInsertState();
  }

  function onKeyDown(event) {
    if (closed || !document.querySelector('.image-upload-overlay')) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      switchPreviewVariant(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      switchPreviewVariant(1);
    }
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
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKeyDown);
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
    previewSources.clear();
    previewRunId += 1;
    inserted = false;
    for (const btn of presetButtons.values()) btn.disabled = true;
    updateInsertState();
  }

  function updateCloseState() {
    updatePickerState();
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

  function updatePickerState() {
    const busy = isUploadBusy();
    pickBtn.disabled = busy;
    pasteBtn.disabled = busy;
  }

  function isUploadBusy() {
    return !!activeUploadId || (!!currentJob && !readyJob);
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

  function showImageError(title, message, err, extra = {}) {
    void (async () => {
      const details = await buildImageErrorDetails(title, message, err, extra);
      showErrorDialog({ title, message, details });
    })();
  }

  async function buildImageErrorDetails(title, message, err, extra) {
    const [frontendVersion, updateInfo] = await Promise.all([
      safeCommand('get_frontend_version', {}, 800),
      safeCommand('check_for_update', {}, 1200),
    ]);
    return {
      title,
      message,
      timestamp: new Date().toISOString(),
      frontend_version: frontendVersion.ok ? frontendVersion.value : `unavailable: ${frontendVersion.error}`,
      native_version: updateInfo.ok ? (updateInfo.value?.current_version || null) : `unavailable: ${updateInfo.error}`,
      latest_native_version: updateInfo.ok ? (updateInfo.value?.latest_version || null) : null,
      update_build_in_progress: updateInfo.ok ? !!updateInfo.value?.build_in_progress : null,
      error: String(err?.message || err || ''),
      active_upload_id: activeUploadId,
      current_job_id: currentJob,
      selected_variant: selectedVariant,
      ready_job: readyJob ? {
        job_id: readyJob.job_id || null,
        status: readyJob.status || null,
        progress_current: readyJob.progress_current ?? null,
        progress_total: readyJob.progress_total ?? null,
        asset_uuid: readyJob.asset_uuid || null,
        error: readyJob.error || null,
      } : null,
      variants: (readyJob?.variants || []).map((variant) => ({
        variant: variant.variant,
        preview_url: variant.preview_url,
        public_token: variant.public_token || null,
        mime_type: variant.mime_type || null,
        size_bytes: variant.size_bytes ?? null,
        width: variant.width ?? null,
        height: variant.height ?? null,
      })),
      loaded_previews: Array.from(loadedPreviews),
      failed_previews: Array.from(failedPreviews.entries()).map(([variant, failure]) => ({
        variant,
        preview_url: failure?.preview_url || null,
        reason: failure?.reason || String(failure || ''),
      })),
      preview_sources: Array.from(previewSources.entries()).map(([variant, src]) => ({
        variant,
        source_kind: src.startsWith('data:') ? 'data_url' : 'remote_url',
        source_prefix: src.slice(0, 80),
      })),
      extra,
    };
  }
}

function openFullPreview(variant, src = variant.preview_url) {
  const overlay = el('div', 'modal-overlay image-full-preview');
  const img = document.createElement('img');
  img.src = src;
  img.alt = variant.variant;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

async function loadPreviewVariant(variant) {
  if (isSnippetsMediaUrl(variant.preview_url)) {
    try {
      return await loadNativePreviewSource(variant.preview_url);
    } catch (fallbackErr) {
      try {
        await preloadImage(variant.preview_url);
        return variant.preview_url;
      } catch (directErr) {
        throw new Error(
          `native preview fallback failed (${String(fallbackErr?.message || fallbackErr)}); direct preview failed (${String(directErr?.message || directErr)})`
        );
      }
    }
  }
  try {
    await preloadImage(variant.preview_url);
    return variant.preview_url;
  } catch (directErr) {
    if (!isRemoteUrl(variant.preview_url)) throw directErr;
    try {
      return await loadNativePreviewSource(variant.preview_url);
    } catch (fallbackErr) {
      throw new Error(
        `direct preview failed (${String(directErr?.message || directErr)}); native preview fallback failed (${String(fallbackErr?.message || fallbackErr)})`
      );
    }
  }
}

async function loadNativePreviewSource(previewUrl) {
  const fallback = await call('get_media_preview_data_url', { previewUrl });
  const dataUrl = fallback?.data_url || '';
  if (!dataUrl) throw new Error('native preview returned empty data_url');
  await preloadImage(dataUrl);
  return dataUrl;
}

function preloadImage(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('preview_url is empty'));
      return;
    }
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => fail(`preview timeout after ${timeoutMs}ms`), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    }

    function done() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }

    function fail(reason) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${reason}: ${url}`));
    }

    img.onload = done;
    img.onerror = () => fail('image onerror');
    img.src = url;
  });
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function isSnippetsMediaUrl(url) {
  if (!isRemoteUrl(url)) return false;
  try {
    return new URL(url).pathname.startsWith('/snippets-media/');
  } catch {
    return false;
  }
}

async function safeCommand(command, args = {}, timeoutMs = 1000) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: `${command} timed out after ${timeoutMs}ms` }), timeoutMs);
  });
  const request = call(command, args)
    .then((value) => ({ ok: true, value }))
    .catch((err) => ({ ok: false, error: String(err?.message || err) }));
  const result = await Promise.race([request, timeout]);
  if (timer) clearTimeout(timer);
  return result;
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
