# VPS Detailed Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicit VPS detailed analysis modal with disk tree drill-down, top memory processes, and raw SSH output.

**Architecture:** Add a new Rust/Tauri command for heavier SSH analysis so normal VPS tile refresh stays fast. Parse `df`, `du`, and `ps` into structured JSON, mirror the command in the browser mock, then add a compact resizable modal in `desktop-rust/src/tabs/vps.js`.

**Tech Stack:** Rust/Tauri commands, serde JSON, vanilla JavaScript frontend, existing `call()` IPC wrapper, existing modal/toast styling, browser mock in `dev-mock.js`.

---

## File Structure

- Modify `desktop-rust/src-tauri/src/commands/vps.rs`
  - Add `vps_get_detailed_analysis`.
  - Add parser helpers for `df`, `du`, `ps`.
  - Add Rust unit tests for detailed parser behavior.
- Modify `desktop-rust/src-tauri/src/lib.rs`
  - Register `commands::vps::vps_get_detailed_analysis`.
- Modify `desktop-rust/src/dev-mock.js`
  - Add `vps_get_detailed_analysis` mock response.
- Modify `desktop-rust/src/tabs/vps.js`
  - Add detailed analysis action.
  - Add modal state, tabs, disk tree, process table, raw tab, resize persistence.
- Modify `desktop-rust/src/tabs/help.js`
  - Add user-facing help text for VPS detailed analysis before release.
- Modify `desktop-rust/CHANGELOG.md`
  - Add release note before release.

---

### Task 1: Rust Parser Tests

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/vps.rs`
- Test: `desktop-rust/src-tauri/src/commands/vps.rs`

- [ ] **Step 1: Add failing parser tests**

Append these tests inside the existing `#[cfg(test)] mod tests` in `desktop-rust/src-tauri/src/commands/vps.rs`:

```rust
#[test]
fn test_parse_detailed_df_root() {
    let df = "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   34G   16G  67% /\n";
    let mount = parse_detailed_df(df).unwrap();
    assert_eq!(mount.path, "/");
    assert_eq!(mount.total, "50G");
    assert_eq!(mount.used, "34G");
    assert_eq!(mount.free, "16G");
    assert!((mount.pct - 67.0).abs() < 0.1);
}

#[test]
fn test_parse_detailed_du_nested_long_paths() {
    let du = "18G\t/var\n14G\t/var/lib\n12G\t/var/lib/docker/overlay2/6d9c1f4e9a-long-layer-cache\n2.1G\t/var/log\n7.2G\t/home\n";
    let entries = parse_detailed_du(du, 34_000_000_000);
    assert_eq!(entries.len(), 5);
    let docker = entries.iter().find(|e| e.path.contains("overlay2")).unwrap();
    assert_eq!(docker.name, "6d9c1f4e9a-long-layer-cache");
    assert_eq!(docker.parent, "/var/lib/docker/overlay2");
    assert!(docker.depth >= 4);
    assert!(docker.bytes > 0);
    assert!(docker.pct_of_used > 0.0);
}

#[test]
fn test_parse_detailed_ps_top_processes() {
    let ps = "PID COMMAND         COMMAND                         RSS %MEM\n421 postgres        postgres                       1887436 23.1\n819 node            node /srv/app/server.js         655360 8.0\n";
    let processes = parse_detailed_ps(ps);
    assert_eq!(processes.len(), 2);
    assert_eq!(processes[0].pid, 421);
    assert_eq!(processes[0].command, "postgres");
    assert_eq!(processes[0].rss_kb, 1_887_436);
    assert_eq!(processes[0].memory, "1.8G");
    assert!((processes[0].mem_pct - 23.1).abs() < 0.1);
    assert!(processes[1].args.contains("/srv/app/server.js"));
}

#[test]
fn test_parse_detailed_analysis_keeps_partial_success_with_stderr() {
    let output = "===DF===\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   34G   16G  67% /\n===DU===\n18G\t/var\n===PS===\nPID COMMAND COMMAND RSS %MEM\n421 postgres postgres 1887436 23.1\n===UPTIME===\nup 3 days\n===HOSTNAME===\napi-prod\n===STDERR===\ndu: cannot read directory '/root': Permission denied\n";
    let parsed = parse_detailed_analysis(output).unwrap();
    assert_eq!(parsed.hostname, "api-prod");
    assert_eq!(parsed.disk.entries.len(), 1);
    assert_eq!(parsed.processes.len(), 1);
    assert!(parsed.raw.stderr.contains("Permission denied"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd desktop-rust/src-tauri && cargo test detailed --lib
```

Expected: FAIL with missing symbols such as `parse_detailed_df`, `parse_detailed_du`, `parse_detailed_ps`, and `parse_detailed_analysis`.

- [ ] **Step 3: Commit failing tests**

```bash
git add desktop-rust/src-tauri/src/commands/vps.rs
git commit -m "test: add vps detailed parser tests"
```

---

### Task 2: Rust Parser Implementation

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/vps.rs`
- Test: `desktop-rust/src-tauri/src/commands/vps.rs`

- [ ] **Step 1: Add detailed analysis data structs**

Add these structs near the existing `VpsEnvironment` struct:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsDetailedAnalysis {
    pub hostname: String,
    pub uptime: String,
    pub disk: VpsDetailedDisk,
    pub processes: Vec<VpsProcessUsage>,
    pub raw: VpsDetailedRaw,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsDetailedDisk {
    pub mount: VpsDiskMount,
    pub entries: Vec<VpsDiskEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsDiskMount {
    pub path: String,
    pub total: String,
    pub used: String,
    pub free: String,
    pub pct: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsDiskEntry {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub depth: u32,
    pub size: String,
    pub bytes: u64,
    pub pct_of_used: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsProcessUsage {
    pub pid: u32,
    pub command: String,
    pub args: String,
    pub rss_kb: u64,
    pub memory: String,
    pub mem_pct: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VpsDetailedRaw {
    pub df: String,
    pub du: String,
    pub ps: String,
    pub stderr: String,
}
```

- [ ] **Step 2: Add parser implementation**

Add these helpers before `#[cfg(test)] mod tests`:

```rust
fn parse_detailed_analysis(output: &str) -> Result<VpsDetailedAnalysis, String> {
    let df = section_between(output, "===DF===", "===DU===");
    let du = section_between(output, "===DU===", "===PS===");
    let ps = section_between(output, "===PS===", "===UPTIME===");
    let uptime = section_between(output, "===UPTIME===", "===HOSTNAME===").trim().to_string();
    let hostname = section_between(output, "===HOSTNAME===", "===STDERR===").trim().to_string();
    let stderr = section_after(output, "===STDERR===").trim().to_string();

    let mount = parse_detailed_df(&df)?;
    let used_bytes = parse_size_to_bytes(&mount.used).unwrap_or(0);
    let entries = parse_detailed_du(&du, used_bytes);
    let processes = parse_detailed_ps(&ps);

    Ok(VpsDetailedAnalysis {
        hostname,
        uptime,
        disk: VpsDetailedDisk { mount, entries },
        processes,
        raw: VpsDetailedRaw { df, du, ps, stderr },
    })
}

fn section_between(output: &str, start: &str, end: &str) -> String {
    let after = section_after(output, start);
    match after.find(end) {
        Some(pos) => after[..pos].to_string(),
        None => after,
    }
}

fn section_after(output: &str, marker: &str) -> String {
    match output.find(marker) {
        Some(pos) => output[pos + marker.len()..].to_string(),
        None => String::new(),
    }
}

fn parse_detailed_df(df_output: &str) -> Result<VpsDiskMount, String> {
    let (total, used, free, pct) = parse_df(df_output);
    if total == "?" {
        return Err("Failed to parse df output".to_string());
    }
    Ok(VpsDiskMount {
        path: "/".to_string(),
        total,
        used,
        free,
        pct,
    })
}

fn parse_detailed_du(du_output: &str, used_bytes: u64) -> Vec<VpsDiskEntry> {
    let mut entries = Vec::new();
    for line in du_output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("du:") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(size) = parts.next() else { continue; };
        let Some(path) = parts.next() else { continue; };
        let bytes = parse_size_to_bytes(size).unwrap_or(0);
        let pct_of_used = if used_bytes > 0 {
            ((bytes as f64 / used_bytes as f64) * 100.0 * 10.0).round() / 10.0
        } else {
            0.0
        };
        let parent = parent_path(path);
        let name = path.rsplit('/').find(|s| !s.is_empty()).unwrap_or(path).to_string();
        let depth = path.split('/').filter(|part| !part.is_empty()).count() as u32;
        entries.push(VpsDiskEntry {
            path: path.to_string(),
            name,
            parent,
            depth,
            size: size.to_string(),
            bytes,
            pct_of_used,
        });
    }
    entries
}

fn parent_path(path: &str) -> String {
    if path == "/" {
        return String::new();
    }
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(pos) => trimmed[..pos].to_string(),
        None => String::new(),
    }
}

fn parse_detailed_ps(ps_output: &str) -> Vec<VpsProcessUsage> {
    let mut processes = Vec::new();
    for line in ps_output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("PID ") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let pid = parts[0].parse::<u32>().unwrap_or(0);
        let command = parts[1].to_string();
        let rss_idx = parts.len() - 2;
        let pct_idx = parts.len() - 1;
        let args = parts[2..rss_idx].join(" ");
        let rss_kb = parts[rss_idx].parse::<u64>().unwrap_or(0);
        let mem_pct = parts[pct_idx].replace(',', ".").parse::<f64>().unwrap_or(0.0);
        processes.push(VpsProcessUsage {
            pid,
            command,
            args,
            rss_kb,
            memory: format_kb_human(rss_kb),
            mem_pct,
        });
    }
    processes
}

fn format_kb_human(kb: u64) -> String {
    let bytes = kb as f64 * 1024.0;
    let gib = bytes / 1024.0 / 1024.0 / 1024.0;
    if gib >= 1.0 {
        return format!("{:.1}G", gib);
    }
    let mib = bytes / 1024.0 / 1024.0;
    if mib >= 1.0 {
        return format!("{:.0}M", mib);
    }
    format!("{}K", kb)
}
```

- [ ] **Step 3: Run parser tests**

Run:

```bash
cd desktop-rust/src-tauri && cargo test detailed --lib
```

Expected: PASS for detailed parser tests.

- [ ] **Step 4: Run full VPS command tests**

Run:

```bash
cd desktop-rust/src-tauri && cargo test vps --lib
```

Expected: PASS for existing VPS tests plus new detailed parser tests.

- [ ] **Step 5: Commit parser implementation**

```bash
git add desktop-rust/src-tauri/src/commands/vps.rs
git commit -m "feat: parse vps detailed analysis"
```

---

### Task 3: Tauri Command And Registration

**Files:**
- Modify: `desktop-rust/src-tauri/src/commands/vps.rs`
- Modify: `desktop-rust/src-tauri/src/lib.rs`
- Test: `desktop-rust/src-tauri/src/commands/vps.rs`

- [ ] **Step 1: Add failing registration check by building**

In `desktop-rust/src-tauri/src/lib.rs`, add this line next to `commands::vps::vps_get_stats`:

```rust
commands::vps::vps_get_detailed_analysis,
```

- [ ] **Step 2: Run check to verify missing command fails**

Run:

```bash
cd desktop-rust/src-tauri && cargo check
```

Expected: FAIL because `vps_get_detailed_analysis` is not defined yet.

- [ ] **Step 3: Add the Tauri command**

Add this command near `vps_get_stats` in `desktop-rust/src-tauri/src/commands/vps.rs`:

```rust
#[tauri::command]
pub async fn vps_get_detailed_analysis(host: String, user: String, port: u16, key_file: String) -> Result<Value, String> {
    let remote_cmd = "echo '===DF==='; df -h /; echo '===DU==='; du -xhd 3 / | sort -hr | head -40; echo '===PS==='; ps -eo pid,comm,args,rss,%mem --sort=-rss | head -40; echo '===UPTIME==='; uptime; echo '===HOSTNAME==='; hostname; echo '===STDERR==='";
    let mut cmd = build_ssh_cmd(&user, &host, port, &key_file, remote_cmd);

    let output = tokio::task::spawn_blocking(move || {
        cmd.stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn ssh: {}", e))?;
        let output = wait_with_timeout(child, Duration::from_secs(20))?;
        Ok::<std::process::Output, String>(output)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "SSH command failed".to_string()
        } else {
            stderr
        });
    }

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if let Some(pos) = stdout.find("===STDERR===") {
        stdout.truncate(pos + "===STDERR===".len());
        stdout.push('\n');
        stdout.push_str(&stderr);
    } else {
        stdout.push_str("\n===STDERR===\n");
        stdout.push_str(&stderr);
    }

    let parsed = parse_detailed_analysis(&stdout)?;
    serde_json::to_value(parsed).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run checks**

Run:

```bash
cd desktop-rust/src-tauri && cargo check
```

Expected: PASS.

Run:

```bash
cd desktop-rust/src-tauri && cargo test vps --lib
```

Expected: PASS.

- [ ] **Step 5: Commit command and registration**

```bash
git add desktop-rust/src-tauri/src/commands/vps.rs desktop-rust/src-tauri/src/lib.rs
git commit -m "feat: add vps detailed analysis command"
```

---

### Task 4: Browser Mock

**Files:**
- Modify: `desktop-rust/src/dev-mock.js`
- Test: `desktop-rust/src/dev-mock.js`

- [ ] **Step 1: Add mock command**

Inside the VPS section of `const handlers = { ... }`, after `async vps_get_stats()`, add:

```js
async vps_get_detailed_analysis() {
  return {
    hostname: 'api-prod',
    uptime: 'up 3 days, 4:12',
    disk: {
      mount: { path: '/', total: '50G', used: '34G', free: '16G', pct: 67 },
      entries: [
        { path: '/var', name: 'var', parent: '/', depth: 1, size: '18G', bytes: 18000000000, pct_of_used: 52.9 },
        { path: '/var/lib', name: 'lib', parent: '/var', depth: 2, size: '14G', bytes: 14000000000, pct_of_used: 41.2 },
        { path: '/var/lib/docker/overlay2/6d9c1f4e9a-long-layer-cache', name: '6d9c1f4e9a-long-layer-cache', parent: '/var/lib/docker/overlay2', depth: 4, size: '12G', bytes: 12000000000, pct_of_used: 35.3 },
        { path: '/var/log', name: 'log', parent: '/var', depth: 2, size: '2.1G', bytes: 2100000000, pct_of_used: 6.2 },
        { path: '/home', name: 'home', parent: '/', depth: 1, size: '7.2G', bytes: 7200000000, pct_of_used: 21.2 },
        { path: '/opt', name: 'opt', parent: '/', depth: 1, size: '4.8G', bytes: 4800000000, pct_of_used: 14.1 },
      ],
    },
    processes: [
      { pid: 421, command: 'postgres', args: 'postgres', rss_kb: 1887436, memory: '1.8G', mem_pct: 23.1 },
      { pid: 819, command: 'node', args: 'node /srv/app/server.js', rss_kb: 655360, memory: '640M', mem_pct: 8.0 },
      { pid: 1044, command: 'redis-server', args: 'redis-server *:6379', rss_kb: 296960, memory: '290M', mem_pct: 4.0 },
      { pid: 1205, command: 'nginx', args: 'nginx: worker process', rss_kb: 122880, memory: '120M', mem_pct: 2.0 },
    ],
    raw: {
      df: 'Filesystem      Size  Used Avail Use% Mounted on\\n/dev/sda1        50G   34G   16G  67% /',
      du: '18G\\t/var\\n14G\\t/var/lib\\n12G\\t/var/lib/docker/overlay2/6d9c1f4e9a-long-layer-cache\\n2.1G\\t/var/log\\n7.2G\\t/home',
      ps: 'PID COMMAND COMMAND RSS %MEM\\n421 postgres postgres 1887436 23.1\\n819 node node /srv/app/server.js 655360 8.0',
      stderr: "du: cannot read directory '/root': Permission denied",
    },
  };
},
```

- [ ] **Step 2: Syntax check**

Run:

```bash
node --check desktop-rust/src/dev-mock.js
```

Expected: PASS with no output.

- [ ] **Step 3: Commit mock command**

```bash
git add desktop-rust/src/dev-mock.js
git commit -m "test: mock vps detailed analysis"
```

---

### Task 5: Frontend Modal Shell And Action Wiring

**Files:**
- Modify: `desktop-rust/src/tabs/vps.js`
- Test: `desktop-rust/src/tabs/vps.js`

- [ ] **Step 1: Add modal state variables**

Near existing module-level state in `desktop-rust/src/tabs/vps.js`, add:

```js
let analysisModal = null; // { overlay, serverIndex, server, activeTab, loading, error, data, collapsed, drillRoot, selectedPath }
const ANALYSIS_WIDTH_SETTING = 'vps.analysis_modal_width';
```

- [ ] **Step 2: Add action entry points**

In `buildDetailPanel()`, after the existing `Refresh` button append:

```js
const analysisBtn = el('button', { text: 'Detailed analysis', class: 'btn-secondary vps-action-btn' });
analysisBtn.addEventListener('click', () => showDetailedAnalysisModal(expandedServer.serverIndex));
actionsBar.appendChild(analysisBtn);
```

In `showTileContextMenu()`, after `Test Connection`, add:

```js
const analysisItem = el('div', { text: 'Detailed analysis', class: 'vps-ctx-item' });
analysisItem.addEventListener('click', () => {
  closeContextMenu();
  showDetailedAnalysisModal(gIdx);
});
menu.appendChild(analysisItem);
```

- [ ] **Step 3: Add modal shell functions**

Add these functions before `showServerModal()`:

```js
async function showDetailedAnalysisModal(gIdx) {
  const srv = allServers[gIdx];
  if (!srv) return;
  closeDetailedAnalysisModal();

  const overlay = el('div', { class: 'modal-overlay vps-analysis-overlay' });
  const modal = el('div', { class: 'modal vps-analysis-modal' });
  const savedWidth = await loadAnalysisModalWidth();
  if (savedWidth) modal.style.width = savedWidth;

  analysisModal = {
    overlay,
    serverIndex: gIdx,
    server: srv,
    activeTab: 'disk',
    loading: true,
    error: null,
    data: null,
    collapsed: new Set(),
    drillRoot: '/',
    selectedPath: '/',
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  renderDetailedAnalysisModal();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetailedAnalysisModal();
  });

  await fetchDetailedAnalysis();
}

function closeDetailedAnalysisModal() {
  if (analysisModal && analysisModal.overlay) {
    analysisModal.overlay.remove();
  }
  analysisModal = null;
}

async function loadAnalysisModalWidth() {
  try {
    const v = await call('get_setting', { key: ANALYSIS_WIDTH_SETTING });
    if (!v) return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(520, Math.min(window.innerWidth * 0.9, n)) + 'px';
  } catch {
    return null;
  }
}

async function persistAnalysisModalWidth(modal) {
  const width = Math.round(modal.getBoundingClientRect().width);
  if (!Number.isFinite(width)) return;
  try {
    await call('set_setting', { key: ANALYSIS_WIDTH_SETTING, value: String(width) });
  } catch {
    // Width persistence is non-critical.
  }
}

async function fetchDetailedAnalysis() {
  if (!analysisModal) return;
  const srv = analysisModal.server;
  analysisModal.loading = true;
  analysisModal.error = null;
  renderDetailedAnalysisModal();
  try {
    const data = await call('vps_get_detailed_analysis', {
      host: srv.host,
      user: srv.user,
      port: srv.port,
      keyFile: srv.key_file,
    });
    analysisModal.data = data;
    analysisModal.loading = false;
    analysisModal.error = null;
    analysisModal.selectedPath = '/';
    analysisModal.drillRoot = '/';
    analysisModal.collapsed = new Set();
  } catch (e) {
    analysisModal.loading = false;
    analysisModal.error = String(e);
  }
  renderDetailedAnalysisModal();
}
```

- [ ] **Step 4: Add basic modal renderer**

Add:

```js
function renderDetailedAnalysisModal() {
  if (!analysisModal) return;
  const modal = analysisModal.overlay.querySelector('.vps-analysis-modal');
  if (!modal) return;
  modal.innerHTML = '';

  const header = el('div', { class: 'vps-analysis-header' });
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', { class: 'vps-analysis-title', text: `${analysisModal.server.name} · Detailed analysis` }));
  titleWrap.appendChild(el('div', { class: 'vps-analysis-subtitle', text: `${analysisModal.server.user}@${analysisModal.server.host}:${analysisModal.server.port}` }));
  header.appendChild(titleWrap);

  const headActions = el('div', { class: 'vps-analysis-head-actions' });
  const refreshBtn = el('button', { text: '\u21BB', class: 'btn-secondary vps-analysis-icon-btn', title: 'Refresh analysis' });
  refreshBtn.addEventListener('click', fetchDetailedAnalysis);
  headActions.appendChild(refreshBtn);
  const closeBtn = el('button', { text: '\u2715', class: 'btn-secondary vps-analysis-icon-btn', title: 'Close' });
  closeBtn.addEventListener('click', closeDetailedAnalysisModal);
  headActions.appendChild(closeBtn);
  header.appendChild(headActions);
  modal.appendChild(header);

  const tabs = el('div', { class: 'vps-analysis-tabs' });
  for (const [key, label] of [['disk', 'Disk'], ['processes', 'Processes'], ['raw', 'Raw']]) {
    const tab = el('button', { text: label, class: 'vps-analysis-tab' + (analysisModal.activeTab === key ? ' active' : '') });
    tab.addEventListener('click', () => {
      analysisModal.activeTab = key;
      renderDetailedAnalysisModal();
    });
    tabs.appendChild(tab);
  }
  modal.appendChild(tabs);

  const body = el('div', { class: 'vps-analysis-body' });
  if (analysisModal.loading) {
    body.appendChild(el('div', { class: 'vps-detail-loading', text: 'Connecting and analyzing...' }));
  } else if (analysisModal.error) {
    const err = el('div', { class: 'vps-detail-error' });
    err.appendChild(el('div', { class: 'vps-error-title', text: 'Analysis failed' }));
    err.appendChild(el('div', { class: 'vps-error-msg', text: analysisModal.error }));
    const retry = el('button', { text: 'Retry', class: 'btn-secondary vps-retry-btn' });
    retry.addEventListener('click', fetchDetailedAnalysis);
    err.appendChild(retry);
    body.appendChild(err);
  } else if (analysisModal.data) {
    body.appendChild(el('div', { text: 'Detailed analysis loaded', class: 'vps-analysis-placeholder' }));
  }
  modal.appendChild(body);

  modal.addEventListener('mouseup', () => persistAnalysisModalWidth(modal), { once: true });
}
```

- [ ] **Step 5: Syntax check**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
```

Expected: PASS with no output.

- [ ] **Step 6: Commit modal shell**

```bash
git add desktop-rust/src/tabs/vps.js
git commit -m "feat: add vps analysis modal shell"
```

---

### Task 6: Disk Tab Tree UI

**Files:**
- Modify: `desktop-rust/src/tabs/vps.js`
- Test: `desktop-rust/src/tabs/vps.js`

- [ ] **Step 1: Replace placeholder with tab renderer dispatch**

In `renderDetailedAnalysisModal()`, replace:

```js
body.appendChild(el('div', { text: 'Detailed analysis loaded', class: 'vps-analysis-placeholder' }));
```

with:

```js
if (analysisModal.activeTab === 'disk') {
  body.appendChild(buildAnalysisDiskTab());
} else if (analysisModal.activeTab === 'processes') {
  body.appendChild(buildAnalysisProcessesTab());
} else {
  body.appendChild(buildAnalysisRawTab());
}
```

- [ ] **Step 2: Add disk tab helpers**

Add:

```js
function buildAnalysisDiskTab() {
  const data = analysisModal.data;
  const wrap = el('div', { class: 'vps-analysis-disk' });
  const mount = data.disk && data.disk.mount ? data.disk.mount : null;
  if (mount) {
    const summary = el('div', { class: 'vps-analysis-summary' });
    summary.appendChild(buildAnalysisMetric('/', mount.pct, `${mount.used} / ${mount.total}`));
    wrap.appendChild(summary);
  }

  const toolbar = el('div', { class: 'vps-analysis-tree-toolbar' });
  toolbar.appendChild(el('div', { class: 'vps-analysis-crumbs', text: analysisModal.drillRoot || '/' }));
  const collapseAll = el('button', { text: 'Collapse all', class: 'btn-secondary vps-analysis-small-btn' });
  collapseAll.addEventListener('click', () => {
    analysisModal.collapsed = new Set((data.disk.entries || []).map(e => e.path));
    renderDetailedAnalysisModal();
  });
  toolbar.appendChild(collapseAll);
  wrap.appendChild(toolbar);

  const tree = el('div', { class: 'vps-analysis-tree' });
  for (const entry of visibleDiskEntries(data.disk.entries || [])) {
    tree.appendChild(buildDiskTreeRow(entry, data.disk.entries || []));
  }
  wrap.appendChild(tree);
  wrap.appendChild(buildSelectedDiskDetails(data.disk.entries || []));
  return wrap;
}

function buildAnalysisMetric(label, pct, valueText) {
  const metric = el('div', { class: 'vps-analysis-metric' });
  const top = el('div', { class: 'vps-analysis-metric-top' });
  top.appendChild(el('span', { text: label }));
  top.appendChild(el('b', { text: `${Number(pct || 0).toFixed(0)}% · ${valueText}` }));
  metric.appendChild(top);
  const bar = el('div', { class: 'vps-analysis-bar' });
  const fill = el('div', { class: 'vps-analysis-bar-fill' });
  fill.style.width = Math.max(0, Math.min(100, Number(pct || 0))) + '%';
  fill.style.background = getBarColor(Number(pct || 0));
  bar.appendChild(fill);
  metric.appendChild(bar);
  return metric;
}

function visibleDiskEntries(entries) {
  const root = analysisModal.drillRoot || '/';
  return entries.filter(entry => {
    if (root !== '/' && entry.path !== root && !entry.path.startsWith(root + '/')) return false;
    let parent = entry.parent;
    while (parent && parent !== '/') {
      if (analysisModal.collapsed.has(parent)) return false;
      const parentEntry = entries.find(e => e.path === parent);
      parent = parentEntry ? parentEntry.parent : '';
    }
    return true;
  });
}

function buildDiskTreeRow(entry, entries) {
  const hasChildren = entries.some(e => e.parent === entry.path);
  const collapsed = analysisModal.collapsed.has(entry.path);
  const row = el('div', { class: 'vps-analysis-tree-row' + (entry.pct_of_used > 30 ? ' hot' : '') });
  row.style.setProperty('--depth', String(Math.max(0, Math.min(4, Number(entry.depth || 0) - 1))));

  const twisty = el('button', { text: hasChildren ? (collapsed ? '\u25B8' : '\u25BE') : '\u00B7', class: 'vps-analysis-twisty' });
  twisty.disabled = !hasChildren;
  twisty.addEventListener('click', (e) => {
    e.stopPropagation();
    if (collapsed) analysisModal.collapsed.delete(entry.path);
    else analysisModal.collapsed.add(entry.path);
    renderDetailedAnalysisModal();
  });
  row.appendChild(twisty);

  const name = el('button', { text: entry.path, class: 'vps-analysis-path' });
  name.title = entry.path;
  name.addEventListener('click', () => {
    analysisModal.selectedPath = entry.path;
    renderDetailedAnalysisModal();
  });
  name.addEventListener('dblclick', () => {
    analysisModal.drillRoot = entry.path;
    analysisModal.selectedPath = entry.path;
    renderDetailedAnalysisModal();
  });
  row.appendChild(name);
  row.appendChild(el('span', { text: entry.size || '?', class: 'vps-analysis-size' }));
  row.appendChild(el('span', { text: `${Number(entry.pct_of_used || 0).toFixed(0)}%`, class: 'vps-analysis-pct' }));
  return row;
}

function buildSelectedDiskDetails(entries) {
  const selected = entries.find(e => e.path === analysisModal.selectedPath) || entries[0] || null;
  const strip = el('div', { class: 'vps-analysis-details-strip' });
  const largest = selected ? entries.filter(e => e.parent === selected.path).sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0] : null;
  strip.appendChild(buildAnalysisDetail('Selected', selected ? selected.path : '/'));
  strip.appendChild(buildAnalysisDetail('Total', selected ? selected.size : '?'));
  strip.appendChild(buildAnalysisDetail('Largest', largest ? `${largest.name} · ${largest.size}` : 'none'));
  strip.appendChild(buildAnalysisDetail('Scan', 'depth 3 · top 40'));
  return strip;
}

function buildAnalysisDetail(label, value) {
  const item = el('div', { class: 'vps-analysis-detail' });
  item.appendChild(el('div', { class: 'vps-analysis-detail-label', text: label }));
  const valueEl = el('div', { class: 'vps-analysis-detail-value', text: value || '' });
  valueEl.title = value || '';
  item.appendChild(valueEl);
  return item;
}
```

- [ ] **Step 3: Add temporary placeholder tab functions**

Add:

```js
function buildAnalysisProcessesTab() {
  return el('div', { text: 'Processes tab pending', class: 'vps-analysis-placeholder' });
}

function buildAnalysisRawTab() {
  return el('div', { text: 'Raw tab pending', class: 'vps-analysis-placeholder' });
}
```

- [ ] **Step 4: Syntax check**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
```

Expected: PASS with no output.

- [ ] **Step 5: Commit disk tree**

```bash
git add desktop-rust/src/tabs/vps.js
git commit -m "feat: render vps disk analysis tree"
```

---

### Task 7: Processes And Raw Tabs

**Files:**
- Modify: `desktop-rust/src/tabs/vps.js`
- Test: `desktop-rust/src/tabs/vps.js`

- [ ] **Step 1: Replace processes placeholder**

Replace `buildAnalysisProcessesTab()` with:

```js
function buildAnalysisProcessesTab() {
  const wrap = el('div', { class: 'vps-analysis-processes' });
  const processes = analysisModal.data.processes || [];
  const head = el('div', { class: 'vps-analysis-process-head' });
  head.appendChild(el('span', { text: 'Process' }));
  head.appendChild(el('span', { text: 'Memory' }));
  head.appendChild(el('span', { text: '%' }));
  wrap.appendChild(head);
  for (const proc of processes) {
    const row = el('div', { class: 'vps-analysis-process-row' });
    const name = el('span', { text: `${proc.command} ${proc.args || ''}`.trim(), class: 'vps-analysis-proc-name' });
    name.title = `${proc.pid} · ${proc.args || proc.command}`;
    row.appendChild(name);
    row.appendChild(el('b', { text: proc.memory || `${proc.rss_kb || 0}K` }));
    row.appendChild(el('span', { text: `${Number(proc.mem_pct || 0).toFixed(1)}%` }));
    wrap.appendChild(row);
  }
  return wrap;
}
```

- [ ] **Step 2: Replace raw placeholder**

Replace `buildAnalysisRawTab()` with:

```js
function buildAnalysisRawTab() {
  const raw = analysisModal.data.raw || {};
  const wrap = el('div', { class: 'vps-analysis-raw' });
  const copyBtn = el('button', { text: 'Copy raw output', class: 'btn-secondary vps-analysis-small-btn' });
  copyBtn.addEventListener('click', async () => {
    const text = formatRawAnalysis(raw);
    try {
      await call('copy_to_clipboard', { text });
      showToast('Raw output copied', 'success');
    } catch (e) {
      showToast('Copy failed: ' + e, 'error');
    }
  });
  wrap.appendChild(copyBtn);
  const pre = document.createElement('pre');
  pre.className = 'vps-analysis-raw-box';
  pre.textContent = formatRawAnalysis(raw);
  wrap.appendChild(pre);
  return wrap;
}

function formatRawAnalysis(raw) {
  return [
    '$ df -h /',
    raw.df || '',
    '',
    '$ du -xhd 3 / | sort -hr | head -40',
    raw.du || '',
    '',
    '$ ps -eo pid,comm,args,rss,%mem --sort=-rss | head -40',
    raw.ps || '',
    '',
    '$ stderr',
    raw.stderr || '',
  ].join('\n');
}
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
```

Expected: PASS with no output.

- [ ] **Step 4: Commit tabs**

```bash
git add desktop-rust/src/tabs/vps.js
git commit -m "feat: add vps process and raw analysis tabs"
```

---

### Task 8: Analysis Modal CSS

**Files:**
- Modify: `desktop-rust/src/tabs/vps.js`
- Test: `desktop-rust/src/tabs/vps.js`

- [ ] **Step 1: Add CSS block**

Inside `css()` in `desktop-rust/src/tabs/vps.js`, before the final modal CSS or before the closing backtick, add:

```css
/* Detailed analysis modal */
.vps-analysis-modal {
  width: 520px;
  min-width: 520px;
  max-width: 90vw;
  max-height: 82vh;
  resize: horizontal;
  overflow: auto;
}
.vps-analysis-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
}
.vps-analysis-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.vps-analysis-subtitle {
  margin-top: 2px;
  color: var(--text-muted);
  font: 10px 'SF Mono', 'Cascadia Code', monospace;
}
.vps-analysis-head-actions {
  display: flex;
  gap: 5px;
}
.vps-analysis-icon-btn {
  width: 26px;
  height: 26px;
  padding: 0;
}
.vps-analysis-tabs {
  display: flex;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.vps-analysis-tab {
  position: relative;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  padding: 8px 10px 7px;
  cursor: pointer;
}
.vps-analysis-tab.active {
  color: var(--text);
}
.vps-analysis-tab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
}
.vps-analysis-body {
  padding: 10px 12px 12px;
  overflow-y: auto;
}
.vps-analysis-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  margin-bottom: 8px;
}
.vps-analysis-metric,
.vps-analysis-tree,
.vps-analysis-detail,
.vps-analysis-process-row,
.vps-analysis-raw-box {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
}
.vps-analysis-metric {
  padding: 7px 8px;
}
.vps-analysis-metric-top {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 11px;
  margin-bottom: 5px;
}
.vps-analysis-bar {
  height: 5px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}
.vps-analysis-bar-fill {
  height: 100%;
  border-radius: 3px;
}
.vps-analysis-tree-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  border: 1px solid var(--border);
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: var(--bg-primary);
  padding: 6px 8px;
}
.vps-analysis-crumbs {
  color: var(--text-muted);
  font: 10px 'SF Mono', 'Cascadia Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vps-analysis-small-btn {
  font-size: 11px;
  padding: 3px 8px;
  white-space: nowrap;
}
.vps-analysis-tree {
  border-radius: 0 0 6px 6px;
  padding: 5px 7px;
  max-height: 310px;
  overflow-y: auto;
}
.vps-analysis-tree-row {
  display: grid;
  grid-template-columns: 20px 1fr 58px 38px;
  gap: 5px;
  align-items: center;
  min-height: 24px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font: 11px 'SF Mono', 'Cascadia Code', monospace;
}
.vps-analysis-tree-row:last-child {
  border-bottom: 0;
}
.vps-analysis-twisty {
  width: 17px;
  height: 17px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  padding: 0;
  cursor: pointer;
}
.vps-analysis-twisty:disabled {
  cursor: default;
  opacity: 0.55;
}
.vps-analysis-path {
  min-width: 0;
  padding-left: calc(var(--depth, 0) * 11px);
  background: transparent;
  border: 0;
  color: var(--text);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.vps-analysis-size {
  text-align: right;
  font-weight: 700;
}
.vps-analysis-tree-row.hot .vps-analysis-size {
  color: var(--danger);
}
.vps-analysis-pct {
  text-align: right;
  color: var(--text-muted);
}
.vps-analysis-details-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 8px;
}
.vps-analysis-detail {
  padding: 7px 8px;
}
.vps-analysis-detail-label {
  color: var(--text-muted);
  font-size: 9px;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.vps-analysis-detail-value {
  font: 11px 'SF Mono', 'Cascadia Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vps-analysis-process-head,
.vps-analysis-process-row {
  display: grid;
  grid-template-columns: 1fr 54px 44px;
  gap: 6px;
  align-items: center;
}
.vps-analysis-process-head {
  color: var(--text-muted);
  font: 10px 'SF Mono', 'Cascadia Code', monospace;
  padding: 0 8px 5px;
}
.vps-analysis-process-row {
  padding: 7px 8px;
  margin-bottom: 5px;
  font: 11px 'SF Mono', 'Cascadia Code', monospace;
}
.vps-analysis-proc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vps-analysis-raw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vps-analysis-raw-box {
  padding: 9px;
  min-height: 270px;
  color: var(--text);
  white-space: pre-wrap;
  overflow: auto;
  font: 10.5px 'SF Mono', 'Cascadia Code', monospace;
}
.vps-analysis-placeholder {
  color: var(--text-muted);
  text-align: center;
  padding: 24px;
}
@media (max-width: 620px) {
  .vps-analysis-modal {
    min-width: 95vw;
    width: 95vw;
    resize: none;
  }
  .vps-analysis-details-strip {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Syntax check**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
```

Expected: PASS with no output.

- [ ] **Step 3: Commit CSS**

```bash
git add desktop-rust/src/tabs/vps.js
git commit -m "style: add vps analysis modal styles"
```

---

### Task 9: Help, Changelog, And Frontend Smoke

**Files:**
- Modify: `desktop-rust/src/tabs/help.js`
- Modify: `desktop-rust/CHANGELOG.md`
- Test: `desktop-rust/src/tabs/vps.js`, `desktop-rust/src/dev-mock.js`

- [ ] **Step 1: Update help text**

In `desktop-rust/src/tabs/help.js`, add a VPS feature note in both English and Russian feature sections:

```text
VPS detailed analysis: open a server's Detailed analysis modal to inspect disk usage by collapsible directory tree, top memory processes, and raw SSH output.
```

```text
Детальный анализ VPS: откройте модалку Detailed analysis у сервера, чтобы посмотреть диск деревом директорий, top процессов по памяти и raw SSH output.
```

- [ ] **Step 2: Update changelog**

Add a top unreleased or next-version section in `desktop-rust/CHANGELOG.md`:

```markdown
## Unreleased

- Added VPS detailed analysis modal with disk tree drill-down, top memory processes, and raw SSH output.
```

If the repository already has an `Unreleased` section, append only the bullet.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
node --check desktop-rust/src/dev-mock.js
node --check desktop-rust/src/tabs/help.js
```

Expected: PASS with no output.

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all tests PASS.

- [ ] **Step 4: Commit docs and smoke readiness**

```bash
git add desktop-rust/src/tabs/help.js desktop-rust/CHANGELOG.md
git commit -m "docs: document vps detailed analysis"
```

---

### Task 10: Final Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run Rust verification**

Run:

```bash
cd desktop-rust/src-tauri && cargo check
```

Expected: PASS.

Run:

```bash
cd desktop-rust/src-tauri && cargo test vps --lib
```

Expected: PASS.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
node --check desktop-rust/src/tabs/vps.js
node --check desktop-rust/src/dev-mock.js
node --check desktop-rust/src/tabs/help.js
```

Expected: PASS with no output.

Run:

```bash
cd desktop-rust/src && python3 dev-test.py
```

Expected: all tests PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended implementation files should be modified or committed. Existing unrelated dirty files from before this task may still appear; do not revert them.

- [ ] **Step 4: Decide release path**

Because `desktop-rust/src-tauri/` changes, release type is `v*`. Follow `desktop-rust/RELEASES.md` only after implementation is complete, tests pass, and the user confirms release timing if unrelated dirty files remain.

