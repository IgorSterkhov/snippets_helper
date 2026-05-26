import { call } from '../tauri-api.js';

export function showErrorDialog({
  title = 'Error',
  message = '',
  details = null,
  copyText = null,
  okLabel = 'OK',
} = {}) {
  const existing = document.querySelector('.error-dialog-overlay');
  if (existing) {
    const okButton = existing.querySelector('.error-dialog-ok');
    if (okButton) okButton.click();
    else existing.remove();
  }

  const detailsText = formatDetails(details);
  const textToCopy = copyText || [title, message, detailsText].filter(Boolean).join('\n\n');

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay error-dialog-overlay';
    overlay.tabIndex = -1;

    const modal = document.createElement('div');
    modal.className = 'modal error-dialog';

    const heading = document.createElement('h3');
    heading.textContent = title;
    modal.appendChild(heading);

    if (message) {
      const messageEl = document.createElement('div');
      messageEl.className = 'error-dialog-message';
      messageEl.textContent = message;
      modal.appendChild(messageEl);
    }

    if (detailsText) {
      const detailsEl = document.createElement('pre');
      detailsEl.className = 'error-dialog-details';
      detailsEl.textContent = detailsText;
      modal.appendChild(detailsEl);
    }

    const actions = document.createElement('div');
    actions.className = 'error-dialog-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary';
    copyBtn.textContent = 'Copy error';
    copyBtn.addEventListener('click', async () => {
      copyBtn.disabled = true;
      const originalLabel = copyBtn.textContent;
      try {
        await copyErrorText(textToCopy);
        copyBtn.textContent = 'Copied';
      } catch (err) {
        copyBtn.textContent = 'Copy failed';
      } finally {
        setTimeout(() => {
          copyBtn.textContent = originalLabel;
          copyBtn.disabled = false;
        }, 1200);
      }
    });

    const okBtn = document.createElement('button');
    okBtn.className = 'error-dialog-ok';
    okBtn.textContent = okLabel;
    okBtn.addEventListener('click', cleanup);

    actions.appendChild(copyBtn);
    actions.appendChild(okBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function onKeydown(e) {
      if (e.key !== 'Escape') return;
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays[overlays.length - 1] !== overlay) return;
      cleanup();
    }

    function cleanup() {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve();
    }

    document.addEventListener('keydown', onKeydown);
    setTimeout(() => okBtn.focus(), 0);
  });
}

function formatDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

async function copyErrorText(text) {
  try {
    await call('copy_to_clipboard', { text });
    return;
  } catch (err) {
    if (!navigator.clipboard?.writeText) throw err;
  }
  await navigator.clipboard.writeText(text);
}
