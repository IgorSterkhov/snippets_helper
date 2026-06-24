import { call } from '../tauri-api.js';
import { showModal } from '../components/modal.js';

let vpsCache = null;

async function loadVpsHosts() {
  if (vpsCache) return vpsCache;
  try {
    const servers = await call('list_vps_servers');
    vpsCache = servers || [];
  } catch {
    vpsCache = [];
  }
  return vpsCache;
}

function hostOptions(vps, includeLocal = true) {
  const opts = [];
  if (includeLocal) opts.push({ value: '__local__', label: 'Local' });
  for (const s of vps) {
    opts.push({
      value: `${s.user}@${s.host}:${s.port || 22}`,
      label: `${s.name} (${s.user}@${s.host})`,
      keyFile: s.key_file || '',
      port: s.port || 22,
    });
  }
  return opts;
}

function selectEl(id, options) {
  const sel = document.createElement('select');
  sel.id = id;
  sel.className = 'exec-template-input';
  sel.style.width = '100%';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  return sel;
}

function fieldLabel(text) {
  const l = document.createElement('label');
  l.className = 'exec-template-label';
  l.style.cssText = 'display:block;margin-top:8px;margin-bottom:4px;color:var(--text);font-size:12px';
  l.textContent = text;
  return l;
}

function templateHint(text) {
  const el = document.createElement('div');
  el.className = 'exec-template-hint';
  el.textContent = text;
  return el;
}

function shellQuote(s) {
  if (!s) return "''";
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

function parseHostValue(v) {
  if (!v || v === '__local__') return { isLocal: true };
  const m = v.match(/^([^@]+)@([^:]+):(\d+)$/);
  if (!m) return { isLocal: false, userHost: v, port: 22 };
  return { isLocal: false, user: m[1], host: m[2], port: parseInt(m[3]) || 22, userHost: `${m[1]}@${m[2]}` };
}

async function pickLocalFiles() {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) throw new Error('Native file picker is not available in this build');
  const result = await open({
    title: 'Choose source files',
    multiple: true,
    directory: false,
  });
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map(String).filter(Boolean);
}

function createSourceList({ prefix, sourceHostId, placeholder }) {
  const wrap = document.createElement('div');
  wrap.className = 'exec-template-source-list-wrap';

  const toolbar = document.createElement('div');
  toolbar.className = 'exec-template-source-toolbar';

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.id = `${prefix}-pick-files`;
  pickBtn.className = 'btn-secondary exec-template-source-pick';
  pickBtn.textContent = 'Choose files...';
  toolbar.appendChild(pickBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = `${prefix}-add-source`;
  addBtn.className = 'btn-secondary exec-template-source-add';
  addBtn.textContent = '+ Add path';
  toolbar.appendChild(addBtn);

  wrap.appendChild(toolbar);

  const list = document.createElement('div');
  list.id = `${prefix}-source-list`;
  list.className = 'exec-template-source-list';
  wrap.appendChild(list);

  const hint = templateHint('For multiple files, use a destination directory.');
  wrap.appendChild(hint);

  const message = document.createElement('div');
  message.className = 'exec-template-source-message';
  message.style.display = 'none';
  wrap.appendChild(message);

  function setMessage(text, kind = 'info') {
    if (!text) {
      message.textContent = '';
      message.style.display = 'none';
      message.dataset.kind = '';
      return;
    }
    message.textContent = text;
    message.dataset.kind = kind;
    message.style.display = '';
  }

  function sourceHost() {
    return parseHostValue(document.getElementById(sourceHostId)?.value);
  }

  function addPath(value = '', focus = false) {
    const row = document.createElement('div');
    row.className = 'exec-template-source-row';

    const input = document.createElement('input');
    input.className = 'exec-template-input exec-template-source-input';
    input.placeholder = placeholder;
    input.value = value;
    row.appendChild(input);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-secondary exec-template-source-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      row.remove();
      if (!list.querySelector('input')) addPath('', true);
    });
    row.appendChild(removeBtn);

    list.appendChild(row);
    if (focus) input.focus();
    return input;
  }

  function clearIfOnlyEmptyRow() {
    const inputs = [...list.querySelectorAll('input')];
    if (inputs.length === 1 && !inputs[0].value.trim()) {
      list.innerHTML = '';
    }
  }

  function getPaths() {
    return [...list.querySelectorAll('input')]
      .map(input => input.value.trim())
      .filter(Boolean);
  }

  pickBtn.addEventListener('click', async () => {
    setMessage('');
    if (!sourceHost().isLocal) {
      setMessage('Native file picker can only choose local source files. Switch Source host to Local or type remote paths manually.', 'error');
      return;
    }
    try {
      const files = await pickLocalFiles();
      if (!files.length) return;
      clearIfOnlyEmptyRow();
      for (const file of files) addPath(file);
    } catch (err) {
      setMessage(String(err?.message || err), 'error');
    }
  });

  addBtn.addEventListener('click', () => {
    setMessage('');
    addPath('', true);
  });

  queueMicrotask(() => {
    document.getElementById(sourceHostId)?.addEventListener('change', () => setMessage(''));
  });
  addPath('');

  return { root: wrap, getPaths };
}

// ── Template picker ──────────────────────────────────────

export async function openTemplatePicker() {
  const choice = await pickTemplateType();
  if (!choice) return null;
  const vps = await loadVpsHosts();
  if (choice === 'scp') return buildScpTemplate(vps);
  if (choice === 'ssh') return buildSshTemplate(vps);
  if (choice === 'rsync') return buildRsyncTemplate(vps);
  return null;
}

async function pickTemplateType() {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const types = [
    { id: 'scp', label: 'SCP', desc: 'Copy files between local and remote hosts' },
    { id: 'ssh', label: 'SSH', desc: 'Run a command on a remote host' },
    { id: 'rsync', label: 'rsync', desc: 'Synchronize directories (fast, incremental)' },
  ];
  let chosen = null;
  for (const t of types) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer';
    row.innerHTML = `
      <input type="radio" name="tpl-type" value="${t.id}" style="margin-top:3px" />
      <span><strong>${t.label}</strong><br><span style="font-size:12px;color:var(--text-muted)">${t.desc}</span></span>
    `;
    body.appendChild(row);
  }
  try {
    await showModal({
      title: 'Choose Template',
      body,
      onConfirm: async () => {
        const sel = body.querySelector('input[name="tpl-type"]:checked');
        if (!sel) throw new Error('Select a template');
        chosen = sel.value;
      },
    });
    return chosen;
  } catch {
    return null;
  }
}

// ── SCP ──────────────────────────────────────────────────

function buildScpTemplate(vps) {
  const body = document.createElement('div');
  body.className = 'exec-template-form';
  queueMicrotask(() => body.closest('.modal')?.classList.add('exec-template-modal'));
  const opts = hostOptions(vps, true);

  body.appendChild(fieldLabel('Source host'));
  body.appendChild(selectEl('scp-src-host', opts));
  body.appendChild(fieldLabel('Source paths'));
  const sourceList = createSourceList({
    prefix: 'scp',
    sourceHostId: 'scp-src-host',
    placeholder: '/path/to/source',
  });
  body.appendChild(sourceList.root);

  body.appendChild(fieldLabel('Destination host'));
  body.appendChild(selectEl('scp-dst-host', opts));
  body.appendChild(fieldLabel('Destination path'));
  const dstPath = document.createElement('input');
  dstPath.id = 'scp-dst-path';
  dstPath.className = 'exec-template-input';
  dstPath.style.width = '100%';
  dstPath.placeholder = '/path/to/dest';
  body.appendChild(dstPath);

  body.appendChild(fieldLabel('Options'));
  const optsRow = document.createElement('div');
  optsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center';
  optsRow.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="scp-r" /> recursive (-r)</label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">Port <input type="number" id="scp-port" value="22" style="width:70px" /></label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">Identity <input id="scp-key" placeholder="~/.ssh/id_rsa" style="width:160px" /></label>
  `;
  body.appendChild(optsRow);

  let generated = null;
  return showModal({
    title: 'SCP Template',
    body,
    onConfirm: async () => {
      const srcHost = parseHostValue(document.getElementById('scp-src-host').value);
      const dstHost = parseHostValue(document.getElementById('scp-dst-host').value);
      const sources = sourceList.getPaths();
      const dst = document.getElementById('scp-dst-path').value.trim();
      const recursive = document.getElementById('scp-r').checked;
      const port = parseInt(document.getElementById('scp-port').value) || 22;
      const key = document.getElementById('scp-key').value.trim();

      if (!sources.length) throw new Error('At least one source path is required');
      if (!dst) throw new Error('Destination path is required');
      if (srcHost.isLocal && dstHost.isLocal) throw new Error('Both ends are local — no transfer needed');

      const parts = ['scp'];
      if (recursive) parts.push('-r');
      if (port && port !== 22) parts.push('-P', String(port));
      if (key) parts.push('-i', shellQuote(key));
      for (const src of sources) parts.push(formatScpEndpoint(srcHost, src));
      parts.push(formatScpEndpoint(dstHost, dst));

      const sourceLabel = sources.length > 1 ? `${shortPath(sources[0])} +${sources.length - 1}` : shortPath(sources[0]);
      generated = {
        command: parts.join(' '),
        name: `scp ${sourceLabel} → ${shortPath(dst)}`,
      };
    },
  }).then(() => generated).catch(() => null);
}

function formatScpEndpoint(host, path) {
  const p = shellQuote(path);
  if (host.isLocal) return p;
  return `${host.userHost}:${p}`;
}

function shortPath(p) {
  if (!p) return '?';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

// ── SSH ──────────────────────────────────────────────────

function buildSshTemplate(vps) {
  const body = document.createElement('div');
  const opts = hostOptions(vps, false);
  if (!opts.length) {
    body.innerHTML = '<p style="color:var(--text-muted)">No VPS configured. Add a server in VPS Management first.</p>';
    return showModal({ title: 'SSH Template', body, onConfirm: async () => { throw new Error('No VPS configured'); } })
      .catch(() => null);
  }

  body.appendChild(fieldLabel('Host'));
  body.appendChild(selectEl('ssh-host', opts));
  body.appendChild(fieldLabel('Command'));
  const cmd = document.createElement('textarea');
  cmd.id = 'ssh-cmd';
  cmd.style.cssText = 'width:100%;min-height:70px;font-family:monospace';
  cmd.placeholder = 'uptime && df -h';
  body.appendChild(cmd);

  body.appendChild(fieldLabel('Options'));
  const optsRow = document.createElement('div');
  optsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center';
  optsRow.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">Port <input type="number" id="ssh-port" value="22" style="width:70px" /></label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">Identity <input id="ssh-key" placeholder="~/.ssh/id_rsa" style="width:160px" /></label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="ssh-tty" /> -t (force TTY)</label>
  `;
  body.appendChild(optsRow);

  let generated = null;
  return showModal({
    title: 'SSH Template',
    body,
    onConfirm: async () => {
      const host = parseHostValue(document.getElementById('ssh-host').value);
      const command = document.getElementById('ssh-cmd').value.trim();
      const port = parseInt(document.getElementById('ssh-port').value) || 22;
      const key = document.getElementById('ssh-key').value.trim();
      const tty = document.getElementById('ssh-tty').checked;

      if (host.isLocal) throw new Error('Select a VPS host');
      if (!command) throw new Error('Command is required');

      const parts = ['ssh'];
      if (tty) parts.push('-t');
      if (port && port !== 22) parts.push('-p', String(port));
      if (key) parts.push('-i', shellQuote(key));
      parts.push(host.userHost);
      parts.push(shellQuote(command));

      const shortCmd = command.length > 30 ? command.slice(0, 30) + '…' : command;
      generated = {
        command: parts.join(' '),
        name: `ssh ${host.userHost}: ${shortCmd}`,
      };
    },
  }).then(() => generated).catch(() => null);
}

// ── rsync ────────────────────────────────────────────────

function buildRsyncTemplate(vps) {
  const body = document.createElement('div');
  body.className = 'exec-template-form';
  queueMicrotask(() => body.closest('.modal')?.classList.add('exec-template-modal'));
  const opts = hostOptions(vps, true);

  body.appendChild(fieldLabel('Source host'));
  body.appendChild(selectEl('rs-src-host', opts));
  body.appendChild(fieldLabel('Source paths'));
  const sourceList = createSourceList({
    prefix: 'rs',
    sourceHostId: 'rs-src-host',
    placeholder: '/path/to/source/',
  });
  body.appendChild(sourceList.root);

  body.appendChild(fieldLabel('Destination host'));
  body.appendChild(selectEl('rs-dst-host', opts));
  body.appendChild(fieldLabel('Destination path'));
  const dstPath = document.createElement('input');
  dstPath.id = 'rs-dst-path';
  dstPath.className = 'exec-template-input';
  dstPath.style.width = '100%';
  dstPath.placeholder = '/path/to/dest/';
  body.appendChild(dstPath);

  body.appendChild(fieldLabel('Flags'));
  const optsRow = document.createElement('div');
  optsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center';
  optsRow.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rs-a" checked /> -a (archive)</label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rs-v" checked /> -v (verbose)</label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rs-z" /> -z (compress)</label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rs-del" /> --delete</label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="rs-dry" /> --dry-run</label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">SSH port <input type="number" id="rs-port" value="22" style="width:70px" /></label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px">Identity <input id="rs-key" placeholder="~/.ssh/id_rsa" style="width:160px" /></label>
  `;
  body.appendChild(optsRow);

  let generated = null;
  return showModal({
    title: 'rsync Template',
    body,
    onConfirm: async () => {
      const srcHost = parseHostValue(document.getElementById('rs-src-host').value);
      const dstHost = parseHostValue(document.getElementById('rs-dst-host').value);
      const sources = sourceList.getPaths();
      const dst = document.getElementById('rs-dst-path').value.trim();
      const port = parseInt(document.getElementById('rs-port').value) || 22;
      const key = document.getElementById('rs-key').value.trim();
      const a = document.getElementById('rs-a').checked;
      const v = document.getElementById('rs-v').checked;
      const z = document.getElementById('rs-z').checked;
      const del = document.getElementById('rs-del').checked;
      const dry = document.getElementById('rs-dry').checked;

      if (!sources.length) throw new Error('At least one source path is required');
      if (!dst) throw new Error('Destination path is required');
      if (!srcHost.isLocal && !dstHost.isLocal) throw new Error('rsync over SSH requires at least one local endpoint');

      const flags = [];
      if (a) flags.push('-a');
      if (v) flags.push('-v');
      if (z) flags.push('-z');
      if (del) flags.push('--delete');
      if (dry) flags.push('--dry-run');

      const needsSsh = !srcHost.isLocal || !dstHost.isLocal;
      const parts = ['rsync', ...flags];
      if (needsSsh && (port !== 22 || key)) {
        const sshParts = ['ssh'];
        if (port !== 22) sshParts.push('-p', String(port));
        if (key) sshParts.push('-i', key);
        parts.push('-e', shellQuote(sshParts.join(' ')));
      }
      for (const src of sources) parts.push(formatScpEndpoint(srcHost, src));
      parts.push(formatScpEndpoint(dstHost, dst));

      const sourceLabel = sources.length > 1 ? `${shortPath(sources[0])} +${sources.length - 1}` : shortPath(sources[0]);
      generated = {
        command: parts.join(' '),
        name: `rsync ${sourceLabel} → ${shortPath(dst)}`,
      };
    },
  }).then(() => generated).catch(() => null);
}
