import { whisperApi, onWhisperEvent } from './whisper-api.js';

export async function initOnboarding(container, { onInstalled } = {}) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:auto;padding:20px;font-family:-apple-system,sans-serif;color:var(--text,#c9d1d9)';

  const [catalog, hw, bin] = await Promise.all([
    whisperApi.listCatalog(),
    whisperApi.gpuInfo(),
    whisperApi.detectWhisperBin(),
  ]);

  const title = document.createElement('h2');
  title.textContent = 'Выберите модель для распознавания';
  title.style.cssText = 'margin:0 0 4px 0;font-size:18px';
  container.appendChild(title);

  const sub = document.createElement('p');
  sub.textContent = 'Модели загружаются с Hugging Face. Можно установить несколько и переключаться в настройках.';
  sub.style.cssText = 'margin:0 0 16px 0;color:var(--text-muted,#8b949e);font-size:13px';
  container.appendChild(sub);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:16px';
  container.appendChild(grid);

  for (const m of catalog) {
    grid.appendChild(renderCard(m, bin, (name) => installModel(name, container, onInstalled)));
  }

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:10px;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);border-radius:4px;color:var(--text-muted,#8b949e);font-size:12px';
  const rec = recommended(hw);
  const parts = [
    escapeHtml(hw.cpu_model),
    `${Math.round(hw.ram_mb / 1024)} GB RAM`,
  ];
  if (hw.gpu_name) {
    const vramGb = hw.vram_mb > 0 ? ` (${(hw.vram_mb / 1024).toFixed(vramGbPrecision(hw.vram_mb))} GB VRAM)` : '';
    parts.push(`<b>${escapeHtml(hw.gpu_name)}</b>${vramGb}`);
  }
  parts.push(hw.cuda ? 'CUDA доступен' : (hw.metal ? 'Metal доступен' : 'только CPU'));
  hint.innerHTML = `💡 <b>Система определила:</b> ${parts.join(', ')}. Лучший выбор — <b>${rec}</b>.`;
  container.appendChild(hint);
}

function renderCard(meta, bin, onInstall) {
  const card = document.createElement('div');
  const highlighted = !!meta.recommended;
  card.style.cssText = `background:var(--bg-secondary,#161b22);border:${highlighted ? '2px solid var(--accent,#388bfd)' : '1px solid var(--border,#30363d)'};border-radius:6px;padding:12px;position:relative`;

  if (highlighted) {
    const badge = document.createElement('span');
    badge.textContent = 'рекомендую';
    badge.style.cssText = 'position:absolute;top:-8px;right:8px;background:var(--accent,#388bfd);color:#fff;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600';
    card.appendChild(badge);
  }

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  header.innerHTML = `<span style="font-weight:600">${escapeHtml(meta.display_name)}</span><span style="background:var(--border,#30363d);color:var(--text-muted,#8b949e);padding:1px 6px;border-radius:8px;font-size:10px">${formatBytes(meta.size_bytes)}</span>`;
  card.appendChild(header);

  const info = document.createElement('div');
  info.style.cssText = 'color:var(--text-muted,#8b949e);font-size:11px;line-height:1.6';
  const speedStars = Math.max(1, 6 - Math.ceil(meta.size_bytes / 5e8));
  info.innerHTML = `
    Скорость: ${'⚡'.repeat(speedStars)}<br>
    Качество RU: ${'★'.repeat(meta.ru_quality)}${'☆'.repeat(5 - meta.ru_quality)}<br>
    Размер: ${formatBytes(meta.size_bytes)}
  `;
  card.appendChild(info);

  if (meta.notes) {
    const note = document.createElement('div');
    note.textContent = meta.notes;
    note.style.cssText = 'margin-top:8px;padding:4px 6px;background:var(--bg,#0d1117);border-radius:3px;color:var(--text-muted,#8b949e);font-size:10px';
    card.appendChild(note);
  }

  const btn = document.createElement('button');
  btn.textContent = `Install ${meta.display_name}`;
  btn.style.cssText = `margin-top:10px;width:100%;padding:6px;background:${highlighted ? 'var(--accent,#388bfd)' : 'var(--bg,#0d1117)'};border:1px solid ${highlighted ? 'var(--accent,#388bfd)' : 'var(--border,#30363d)'};color:${highlighted ? '#fff' : 'var(--text,#c9d1d9)'};font-size:11px;border-radius:4px;cursor:pointer;font-weight:${highlighted ? '600' : 'normal'}`;
  btn.onclick = () => onInstall(meta.name);
  card.appendChild(btn);

  return card;
}

async function installModel(name, container, onInstalled) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(13,17,23,.9);display:flex;align-items:center;justify-content:center;z-index:10';
  container.style.position = 'relative';
  container.appendChild(overlay);

  const panel = document.createElement('div');
  panel.style.cssText = 'max-width:420px;width:100%;background:var(--bg-secondary,#161b22);border:1px solid var(--border,#30363d);border-radius:6px;padding:14px;color:var(--text,#c9d1d9)';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-weight:600">Скачиваю ${escapeHtml(name)}</span>
      <span id="dl-stat" style="margin-left:auto;color:var(--text-muted,#8b949e);font-size:12px">0 / ?</span>
    </div>
    <div style="height:4px;background:var(--border,#30363d);border-radius:2px;overflow:hidden">
      <div id="dl-bar" style="width:0%;height:100%;background:var(--accent,#388bfd)"></div>
    </div>
    <div id="dl-meta" style="display:flex;gap:8px;margin-top:8px;font-size:11px;color:var(--text-muted,#8b949e)"></div>
  `;
  overlay.appendChild(panel);

  const bar = panel.querySelector('#dl-bar');
  const stat = panel.querySelector('#dl-stat');
  const meta = panel.querySelector('#dl-meta');

  const unlisten = await onWhisperEvent('modelDownload', (p) => {
    if (p.model !== name) return;
    const pct = p.bytes_total > 0 ? Math.min(100, p.bytes_done / p.bytes_total * 100) : 0;
    bar.style.width = pct + '%';
    stat.textContent = `${formatBytes(p.bytes_done)} / ${formatBytes(p.bytes_total)}`;
    const speed = p.speed_bps > 0 ? `${formatBytes(p.speed_bps)}/s` : '';
    const etaSec = p.speed_bps > 0 ? Math.max(0, Math.floor((p.bytes_total - p.bytes_done) / p.speed_bps)) : null;
    meta.textContent = [speed, etaSec !== null ? `осталось ~${formatEta(etaSec)}` : ''].filter(Boolean).join(' · ');
    if (p.finished && !p.error) meta.innerHTML += ' <span style="color:var(--green,#3fb950);margin-left:auto">✓ checksum ok</span>';
    if (p.error) meta.innerHTML = `<span style="color:var(--red,#f85149)">Ошибка: ${escapeHtml(p.error)}</span>`;
  });

  try {
    await whisperApi.installModel(name);
    if (unlisten) unlisten();
    overlay.remove();
    if (onInstalled) onInstalled();
  } catch (e) {
    if (unlisten) unlisten();
    meta.innerHTML = `<span style="color:var(--red,#f85149)">Ошибка: ${escapeHtml(String(e))}</span>`;
  }
}

function recommended(hw) {
  if (hw.ram_mb >= 8000 && (hw.metal || hw.cuda)) return 'small или large-v3-q5';
  if (hw.ram_mb >= 8000) return 'small';
  return 'tiny';
}

function vramGbPrecision(mb) {
  // VRAM usually reported in MB; e.g. 12288 MB → 12 GB, 8192 MB → 8 GB.
  // Use 0 decimals for round GB, 1 decimal for odd values like 6144→6 or 11264→11.
  return (mb % 1024 === 0) ? 0 : 1;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${units[i]}`;
}
function formatEta(sec) {
  if (sec < 60) return `${sec} сек`;
  if (sec < 3600) return `${Math.floor(sec/60)} мин ${sec%60} сек`;
  return `${Math.floor(sec/3600)} ч ${Math.floor((sec%3600)/60)} мин`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
