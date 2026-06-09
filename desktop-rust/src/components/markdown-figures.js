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
    figure.appendChild(img);
    figure.appendChild(caption);
    hydrateNativeMediaPreview(img, originalSrc);
  }
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
