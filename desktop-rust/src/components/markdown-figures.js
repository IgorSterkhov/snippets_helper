import { call } from '../tauri-api.js';

const mediaPreviewCache = new Map();

export function enhanceMarkdownFigures(root) {
  if (!root) return;
  const images = [...root.querySelectorAll('img')];
  for (const img of images) {
    if (img.closest('.markdown-figure-card')) continue;
    if (img.closest('.markdown-html-card')) continue;
    const originalSrc = img.getAttribute('src') || '';
    if (isHtmlCardImage(img, originalSrc)) {
      renderHtmlCard(img, originalSrc);
      continue;
    }
    const figure = document.createElement('figure');
    figure.className = 'markdown-figure-card';
    const caption = document.createElement('figcaption');
    caption.textContent = img.getAttribute('alt') || imageName(originalSrc) || 'image';
    const parent = img.parentElement;
    const isImageOnlyParagraph = parent?.tagName === 'P'
      && parent.textContent.trim() === ''
      && parent.querySelectorAll('img').length === 1;
    if (isImageOnlyParagraph) {
      parent.replaceWith(figure);
    } else {
      img.before(figure);
    }
    const media = document.createElement('div');
    media.className = 'markdown-figure-media';
    media.appendChild(img);
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'markdown-figure-zoom';
    zoomBtn.textContent = '⌕';
    zoomBtn.title = 'Open original-size image';
    zoomBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageViewerFromFigure(img, originalSrc, caption.textContent);
    });
    media.appendChild(zoomBtn);
    img.addEventListener('click', (event) => {
      event.preventDefault();
      openImageViewerFromFigure(img, originalSrc, caption.textContent);
    });
    figure.appendChild(media);
    figure.appendChild(caption);
    hydrateNativeMediaPreview(img, originalSrc);
  }
}

async function openImageViewerFromFigure(img, originalSrc, title) {
  const identitySrc = img.dataset.originalSrc || originalSrc || img.getAttribute('src') || '';
  const displaySrc = await resolveDisplaySrc(img, identitySrc);
  openImageViewer({
    title: title || imageName(identitySrc) || 'image',
    identitySrc,
    displaySrc,
  });
}

async function resolveDisplaySrc(img, identitySrc) {
  const currentSrc = img.getAttribute('src') || '';
  if (currentSrc.startsWith('data:')) return currentSrc;
  if (isSnippetsMediaUrl(identitySrc)) {
    try {
      if (!mediaPreviewCache.has(identitySrc)) {
        mediaPreviewCache.set(
          identitySrc,
          call('get_media_preview_data_url', { previewUrl: identitySrc }).then((res) => res?.data_url || '')
        );
      }
      const dataUrl = await mediaPreviewCache.get(identitySrc);
      if (dataUrl) return dataUrl;
    } catch {}
  }
  return currentSrc || identitySrc;
}

function openImageViewer({ title, identitySrc, displaySrc }) {
  const existing = document.querySelector('.markdown-image-viewer-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay markdown-image-viewer-overlay';

  const modal = document.createElement('div');
  modal.className = 'markdown-image-viewer-modal';

  const header = document.createElement('div');
  header.className = 'markdown-image-viewer-header';

  const label = document.createElement('div');
  label.className = 'markdown-image-viewer-title';
  label.textContent = title || 'image';
  header.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'markdown-image-viewer-actions';

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'markdown-image-viewer-zoom-label';
  zoomLabel.textContent = '100%';
  actions.appendChild(zoomLabel);

  const actualBtn = document.createElement('button');
  actualBtn.type = 'button';
  actualBtn.textContent = 'Actual size';
  actualBtn.title = 'Toggle fit and actual saved-file size';
  actions.appendChild(actualBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.title = 'Close image viewer';
  actions.appendChild(closeBtn);
  header.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'markdown-image-viewer-body fit';
  body.tabIndex = 0;
  body.title = 'Ctrl + mouse wheel to zoom. Drag to pan.';
  const image = document.createElement('img');
  image.alt = title || '';
  image.draggable = false;
  image.src = displaySrc || identitySrc;
  body.appendChild(image);

  const meta = document.createElement('div');
  meta.className = 'markdown-image-viewer-meta';
  meta.textContent = identitySrc || '';

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(meta);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const state = {
    scale: 1,
    fitScale: 1,
    panX: 0,
    panY: 0,
    mode: 'fit',
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0,
    pointerId: null,
  };

  const minScale = 0.1;
  const maxScale = 8;

  function naturalSize() {
    return {
      width: Math.max(1, image.naturalWidth || image.width || 1),
      height: Math.max(1, image.naturalHeight || image.height || 1),
    };
  }

  function computeFitScale() {
    const rect = body.getBoundingClientRect();
    const size = naturalSize();
    const availableW = Math.max(1, rect.width - 28);
    const availableH = Math.max(1, rect.height - 28);
    const next = Math.min(1, availableW / size.width, availableH / size.height);
    return Number.isFinite(next) && next > 0 ? next : 1;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampPan() {
    const rect = body.getBoundingClientRect();
    const size = naturalSize();
    const scaledW = size.width * state.scale;
    const scaledH = size.height * state.scale;
    const slack = 80;
    const maxX = scaledW <= rect.width
      ? Math.max(0, (rect.width - scaledW) / 2)
      : (scaledW - rect.width) / 2 + slack;
    const maxY = scaledH <= rect.height
      ? Math.max(0, (rect.height - scaledH) / 2)
      : (scaledH - rect.height) / 2 + slack;
    state.panX = clamp(state.panX, -maxX, maxX);
    state.panY = clamp(state.panY, -maxY, maxY);
  }

  function applyTransform() {
    clampPan();
    body.classList.toggle('actual', state.mode === 'actual');
    body.classList.toggle('fit', state.mode === 'fit');
    body.classList.toggle('custom', state.mode === 'custom');
    image.style.transform = `translate(calc(-50% + ${state.panX}px), calc(-50% + ${state.panY}px)) scale(${state.scale})`;
    zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
    actualBtn.textContent = state.mode === 'fit' ? 'Actual size' : 'Fit';
  }

  function setMode(mode) {
    state.mode = mode;
    state.fitScale = computeFitScale();
    state.scale = mode === 'actual' ? 1 : state.fitScale;
    state.panX = 0;
    state.panY = 0;
    applyTransform();
  }

  function recalculateFit() {
    state.fitScale = computeFitScale();
    if (state.mode === 'fit') {
      state.scale = state.fitScale;
      state.panX = 0;
      state.panY = 0;
    }
    applyTransform();
  }

  function zoomAt(clientX, clientY, nextScale) {
    const rect = body.getBoundingClientRect();
    const cursorX = Number.isFinite(clientX) ? clientX - rect.left - (rect.width / 2) : 0;
    const cursorY = Number.isFinite(clientY) ? clientY - rect.top - (rect.height / 2) : 0;
    const imageX = (cursorX - state.panX) / state.scale;
    const imageY = (cursorY - state.panY) / state.scale;
    state.scale = clamp(nextScale, minScale, maxScale);
    state.panX = cursorX - (imageX * state.scale);
    state.panY = cursorY - (imageY * state.scale);
    state.mode = 'custom';
    applyTransform();
  }

  function onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, state.scale * factor);
  }

  function endDrag() {
    if (!state.dragging) return;
    state.dragging = false;
    state.pointerId = null;
    body.classList.remove('dragging');
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    body.focus({ preventScroll: true });
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
    body.classList.add('dragging');
    try {
      body.setPointerCapture(event.pointerId);
    } catch {}
  }

  function onPointerMove(event) {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    state.panX = state.panStartX + (event.clientX - state.dragStartX);
    state.panY = state.panStartY + (event.clientY - state.dragStartY);
    state.mode = state.mode === 'fit' ? 'custom' : state.mode;
    applyTransform();
  }

  actualBtn.addEventListener('click', () => {
    setMode(state.mode === 'fit' ? 'actual' : 'fit');
  });
  image.addEventListener('dragstart', (event) => event.preventDefault());
  image.addEventListener('load', recalculateFit);
  body.addEventListener('wheel', onWheel, { passive: false });
  body.addEventListener('pointerdown', onPointerDown);
  body.addEventListener('pointermove', onPointerMove);
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(recalculateFit)
    : null;
  resizeObserver?.observe(body);
  requestAnimationFrame(recalculateFit);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    resizeObserver?.disconnect();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);
}

function renderHtmlCard(img, originalSrc) {
  const figure = document.createElement('figure');
  figure.className = 'markdown-html-card';
  const parent = img.parentElement;
  const title = htmlCardTitle(img.getAttribute('alt') || '') || htmlName(originalSrc) || 'HTML';

  const header = document.createElement('figcaption');
  const label = document.createElement('span');
  label.textContent = title;
  header.appendChild(label);

  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Open';
  open.title = 'Open HTML in browser';
  open.addEventListener('click', async () => {
    try {
      await call('open_url', { url: originalSrc });
    } catch {
      window.open(originalSrc, '_blank', 'noopener,noreferrer');
    }
  });
  header.appendChild(open);

  const frame = document.createElement('iframe');
  frame.src = originalSrc;
  frame.title = title;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts');

  const isOnlyParagraph = parent?.tagName === 'P'
    && parent.textContent.trim() === ''
    && parent.querySelectorAll('img').length === 1;
  if (isOnlyParagraph) {
    parent.replaceWith(figure);
  } else {
    img.before(figure);
    img.remove();
  }
  figure.appendChild(header);
  figure.appendChild(frame);
}

function hydrateNativeMediaPreview(img, originalSrc) {
  if (!isSnippetsMediaUrl(originalSrc) || img.dataset.nativeMediaPreview) return;
  img.dataset.nativeMediaPreview = 'loading';
  if (!mediaPreviewCache.has(originalSrc)) {
    mediaPreviewCache.set(
      originalSrc,
      call('get_media_preview_data_url', { previewUrl: originalSrc }).then((res) => res?.data_url || '')
    );
  }
  mediaPreviewCache.get(originalSrc)
    .then((dataUrl) => {
      if (!dataUrl || !img.isConnected) return;
      if ((img.getAttribute('src') || '') !== originalSrc) return;
      img.dataset.originalSrc = originalSrc;
      img.dataset.nativeMediaPreview = 'loaded';
      img.src = dataUrl;
    })
    .catch(() => {
      img.dataset.nativeMediaPreview = 'failed';
    });
}

function isSnippetsMediaUrl(src) {
  if (!/^https?:\/\//i.test(String(src || ''))) return false;
  try {
    return new URL(src).pathname.startsWith('/snippets-media/');
  } catch {
    return false;
  }
}

function isHtmlCardImage(img, src) {
  const alt = String(img.getAttribute('alt') || '').trim().toLowerCase();
  return alt.startsWith('html:') && isSnippetsHtmlUrl(src);
}

function isSnippetsHtmlUrl(src) {
  if (!/^https?:\/\//i.test(String(src || ''))) return false;
  try {
    const url = new URL(src);
    if (!['ister-app.ru', 'localhost', '127.0.0.1'].includes(url.hostname)) return false;
    const prefix = ['/snippets-api/v1/media/html/', '/v1/media/html/']
      .find((item) => url.pathname.startsWith(item));
    if (!prefix) return false;
    const token = url.pathname.slice(prefix.length);
    return /^[A-Za-z0-9_-]{16,}$/.test(token);
  } catch {
    return false;
  }
}

function htmlCardTitle(alt) {
  const raw = String(alt || '').trim();
  return raw.toLowerCase().startsWith('html:') ? raw.slice(5).trim() : raw;
}

function htmlName(src) {
  if (!src) return '';
  try {
    const path = new URL(src, window.location.href).pathname;
    const name = path.split('/').pop() || '';
    return name.replace(/\.[^.]+$/, '');
  } catch {
    return '';
  }
}

function imageName(src) {
  if (!src) return '';
  try {
    const path = new URL(src, window.location.href).pathname;
    const name = path.split('/').pop() || '';
    return name.replace(/\.[^.]+$/, '');
  } catch {
    return '';
  }
}
