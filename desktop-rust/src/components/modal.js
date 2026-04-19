export function showModal({ title, body, onConfirm, onCancel }) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title || '';
    modal.appendChild(titleEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-body';
    if (typeof body === 'string') {
      bodyEl.innerHTML = body;
    } else if (body instanceof HTMLElement) {
      bodyEl.appendChild(body);
    }
    modal.appendChild(bodyEl);

    const errorEl = document.createElement('div');
    errorEl.className = 'modal-error';
    errorEl.style.cssText = 'color:var(--danger,#e06c75);padding:6px 0 0;font-size:12px;display:none;white-space:pre-wrap';
    modal.appendChild(errorEl);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let busy = false;

    async function attemptConfirm() {
      if (busy) return;
      if (onConfirm) {
        busy = true;
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        errorEl.style.display = 'none';
        errorEl.textContent = '';
        try {
          await onConfirm();
        } catch (err) {
          busy = false;
          confirmBtn.disabled = false;
          cancelBtn.disabled = false;
          errorEl.textContent = String(err?.message || err);
          errorEl.style.display = '';
          return;
        }
      }
      cleanup();
      resolve();
    }

    function doCancel() {
      if (busy) return;
      cleanup();
      if (onCancel) onCancel();
      reject(new Error('cancelled'));
    }

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
    }

    confirmBtn.addEventListener('click', attemptConfirm);
    cancelBtn.addEventListener('click', doCancel);

    function onKeydown(e) {
      if (e.key !== 'Escape') return;
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays[overlays.length - 1] !== overlay) return;
      doCancel();
    }
    document.addEventListener('keydown', onKeydown);
  });
}
