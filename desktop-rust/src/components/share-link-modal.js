import { call } from '../tauri-api.js';
import { showToast } from './toast.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await call('copy_to_clipboard', { text });
  }
}

function makeButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  if (className) btn.className = className;
  btn.addEventListener('click', onClick);
  return btn;
}

export async function openShareLinkModal({
  itemType,
  itemUuid,
  title,
  onChange,
  onBeforeCreate,
  syncBeforeCreate = true,
}) {
  if (!itemUuid) {
    showToast('Save item before sharing', 'error');
    return;
  }

  let link = null;
  let telegraphPage = null;
  try {
    const [linkResult, telegraphResult] = await Promise.allSettled([
      call('get_share_link', { itemType, itemUuid }),
      call('get_telegraph_page', { itemType, itemUuid }),
    ]);
    if (linkResult.status === 'rejected') throw linkResult.reason;
    link = linkResult.value;
    telegraphPage = telegraphResult.status === 'fulfilled' ? telegraphResult.value : null;
  } catch (err) {
    showToast('Failed to load share link: ' + err, 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal share-link-dialog';
  overlay.appendChild(modal);

  const heading = document.createElement('h3');
  heading.textContent = 'Share link';
  modal.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'share-link-modal';
  modal.appendChild(body);

  const name = document.createElement('div');
  name.className = 'share-link-title';
  name.textContent = title || 'Shared item';
  body.appendChild(name);

  const status = document.createElement('div');
  status.className = link ? 'share-link-status active' : 'share-link-status';
  status.textContent = link ? 'Public live link is active' : 'No public link';
  body.appendChild(status);

  if (link) {
    const input = document.createElement('input');
    input.className = 'share-link-input';
    input.value = link.public_url;
    input.readOnly = true;
    input.addEventListener('focus', () => input.select());
    body.appendChild(input);
  }

  const telegraphSection = document.createElement('div');
  telegraphSection.className = 'share-link-telegraph';
  body.appendChild(telegraphSection);

  const actions = document.createElement('div');
  actions.className = 'share-link-actions';
  body.appendChild(actions);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  function renderTelegraphSection() {
    telegraphSection.innerHTML = '';
    const titleRow = document.createElement('div');
    titleRow.className = 'share-link-section-title';
    titleRow.textContent = 'Telegra.ph';
    telegraphSection.appendChild(titleRow);

    const hint = document.createElement('div');
    hint.className = telegraphPage ? 'share-link-status active' : 'share-link-status';
    hint.textContent = telegraphPage
      ? `Published snapshot${telegraphPage.views != null ? ` · ${telegraphPage.views} views` : ''}`
      : 'No Telegra.ph page yet';
    telegraphSection.appendChild(hint);

    if (telegraphPage?.url) {
      const input = document.createElement('input');
      input.className = 'share-link-input';
      input.value = telegraphPage.url;
      input.readOnly = true;
      input.addEventListener('focus', () => input.select());
      telegraphSection.appendChild(input);
    }

    const row = document.createElement('div');
    row.className = 'share-link-actions share-link-telegraph-actions';
    telegraphSection.appendChild(row);

    row.appendChild(makeButton(telegraphPage ? 'Update Telegra.ph' : 'Publish to Telegra.ph', '', async (event) => {
      const btn = event.currentTarget;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = telegraphPage ? 'Updating...' : 'Publishing...';
      try {
        if (onBeforeCreate) {
          const updated = await onBeforeCreate();
          if (updated?.itemUuid) itemUuid = updated.itemUuid;
          if (updated?.title) title = updated.title;
        }
        if (syncBeforeCreate) {
          await call('trigger_sync');
        }
        telegraphPage = await call('publish_telegraph_page', { itemType, itemUuid });
        await copyText(telegraphPage.url);
        showToast('Telegra.ph page published and copied', 'success');
        renderTelegraphSection();
      } catch (err) {
        showToast('Failed to publish to Telegra.ph: ' + err, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }));

    if (telegraphPage?.url) {
      row.appendChild(makeButton('Copy', 'btn-secondary', async () => {
        await copyText(telegraphPage.url);
        showToast('Telegra.ph link copied', 'success');
      }));
      row.appendChild(makeButton('Open', 'btn-secondary', async () => {
        await call('open_link_window', { url: telegraphPage.url, title: telegraphPage.title || title || 'Telegra.ph' });
      }));
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  if (!link) {
    actions.appendChild(makeButton('Create link', '', async (event) => {
      const btn = event.currentTarget;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Creating...';
      try {
        if (onBeforeCreate) {
          const updated = await onBeforeCreate();
          if (updated?.itemUuid) itemUuid = updated.itemUuid;
          if (updated?.title) title = updated.title;
        }
        if (syncBeforeCreate) {
          await call('trigger_sync');
        }
        link = await call('create_share_link', { itemType, itemUuid });
        await copyText(link.public_url);
        showToast('Public link created and copied', 'success');
        if (onChange) onChange(link);
        close();
      } catch (err) {
        showToast('Failed to create link: ' + err, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }));
  } else {
    actions.appendChild(makeButton('Copy link', '', async () => {
      await copyText(link.public_url);
      showToast('Link copied', 'success');
    }));
    actions.appendChild(makeButton('Open preview', 'btn-secondary', async () => {
      await call('open_link_window', { url: link.public_url, title: title || 'Shared item' });
    }));
    actions.appendChild(makeButton('Revoke', 'btn-danger', async () => {
      try {
        await call('revoke_share_link', { token: link.token });
        showToast('Link revoked', 'success');
        if (onChange) onChange(null);
        close();
      } catch (err) {
        showToast('Failed to revoke link: ' + err, 'error');
      }
    }));
  }

  renderTelegraphSection();
  actions.appendChild(makeButton('Close', 'btn-secondary', close));

  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(overlay);
}
