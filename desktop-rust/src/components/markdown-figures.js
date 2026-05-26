import { call } from '../tauri-api.js';

const mediaPreviewCache = new Map();

export function enhanceMarkdownFigures(root) {
  if (!root) return;
  const images = [...root.querySelectorAll('img')];
  for (const img of images) {
    if (img.closest('.markdown-figure-card')) continue;
    const originalSrc = img.getAttribute('src') || '';
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
