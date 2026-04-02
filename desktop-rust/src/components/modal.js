export function showModal({ title, body, onConfirm, onCancel }) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    // Title
    const titleEl = document.createElement('h3');
    titleEl.textContent = title || '';
    modal.appendChild(titleEl);

    // Body
    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-body';
    if (typeof body === 'string') {
      bodyEl.innerHTML = body;
    } else if (body instanceof HTMLElement) {
      bodyEl.appendChild(body);
    }
    modal.appendChild(bodyEl);

    // Actions
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

    function close(confirmed) {
      overlay.remove();
      if (confirmed) {
        if (onConfirm) onConfirm();
        resolve();
      } else {
        if (onCancel) onCancel();
        reject(new Error('cancelled'));
      }
    }

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    function onKeydown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        close(false);
      }
    }
    document.addEventListener('keydown', onKeydown);
  });
}
