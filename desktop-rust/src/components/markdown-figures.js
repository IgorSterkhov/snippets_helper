export function enhanceMarkdownFigures(root) {
  if (!root) return;
  const images = [...root.querySelectorAll('img')];
  for (const img of images) {
    if (img.closest('.markdown-figure-card')) continue;
    const figure = document.createElement('figure');
    figure.className = 'markdown-figure-card';
    const caption = document.createElement('figcaption');
    caption.textContent = img.getAttribute('alt') || imageName(img.getAttribute('src')) || 'image';
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
