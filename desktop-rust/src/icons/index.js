// Central registry of pickable icons for group + snippet-tag selectors.
//
// Each entry has:
//   kind:   'emoji' | 'logo'
//   key:    stored in the DB — `emoji:<char>` | `logo:<slug>` | `text:<str>`
//   label:  search-friendly name shown on hover / used for filtering
//   chars?: (emoji only) the grapheme itself
//   slug?:  (logo only) filename under `/icons/logos/<slug>.svg`

export const EMOJIS = [
  { kind: 'emoji', label: 'Folder',        chars: '🗄' },
  { kind: 'emoji', label: 'Sync',          chars: '🔄' },
  { kind: 'emoji', label: 'Web',           chars: '🌐' },
  { kind: 'emoji', label: 'Desktop',       chars: '💻' },
  { kind: 'emoji', label: 'Mobile',        chars: '📱' },
  { kind: 'emoji', label: 'Config Wrench', chars: '🔧' },
  { kind: 'emoji', label: 'Docs',          chars: '📄' },
  { kind: 'emoji', label: 'Scripts Bolt',  chars: '⚡' },
  { kind: 'emoji', label: 'ML Robot',      chars: '🤖' },
  { kind: 'emoji', label: 'Analytics',     chars: '📊' },
  { kind: 'emoji', label: 'Security Lock', chars: '🔒' },
  { kind: 'emoji', label: 'Tests Flask',   chars: '🧪' },
  { kind: 'emoji', label: 'DevOps Rocket', chars: '🚀' },
  { kind: 'emoji', label: 'Design Palette',chars: '🎨' },
  { kind: 'emoji', label: 'Generic Folder',chars: '📁' },
];

// Simple Icons (CC0). SVG files live under icons/logos/<slug>.svg.
export const LOGOS = [
  // Languages
  { kind: 'logo', slug: 'python',           label: 'Python' },
  { kind: 'logo', slug: 'rust',             label: 'Rust' },
  { kind: 'logo', slug: 'go',               label: 'Go' },
  { kind: 'logo', slug: 'javascript',       label: 'JavaScript' },
  { kind: 'logo', slug: 'typescript',       label: 'TypeScript' },
  // Databases
  { kind: 'logo', slug: 'postgresql',       label: 'PostgreSQL' },
  { kind: 'logo', slug: 'mysql',            label: 'MySQL' },
  { kind: 'logo', slug: 'redis',            label: 'Redis' },
  { kind: 'logo', slug: 'clickhouse',       label: 'ClickHouse' },
  { kind: 'logo', slug: 'mongodb',          label: 'MongoDB' },
  { kind: 'logo', slug: 'sqlite',           label: 'SQLite' },
  // Data / ETL
  { kind: 'logo', slug: 'apacheairflow',    label: 'Apache Airflow' },
  { kind: 'logo', slug: 'apachekafka',      label: 'Apache Kafka' },
  { kind: 'logo', slug: 'apachespark',      label: 'Apache Spark' },
  { kind: 'logo', slug: 'apacheflink',      label: 'Apache Flink' },
  { kind: 'logo', slug: 'dbt',              label: 'dbt' },
  { kind: 'logo', slug: 'elasticsearch',    label: 'Elasticsearch' },
  { kind: 'logo', slug: 'apachehadoop',     label: 'Apache Hadoop' },
  { kind: 'logo', slug: 'apachesuperset',   label: 'Apache Superset' },
  // Cloud / infra
  { kind: 'logo', slug: 'docker',           label: 'Docker' },
  { kind: 'logo', slug: 'kubernetes',       label: 'Kubernetes' },
  { kind: 'logo', slug: 'amazonwebservices',label: 'AWS (Amazon Web Services)' },
  { kind: 'logo', slug: 'googlecloud',      label: 'Google Cloud (GCP)' },
  { kind: 'logo', slug: 'nginx',            label: 'nginx' },
  { kind: 'logo', slug: 'ansible',          label: 'Ansible' },
  { kind: 'logo', slug: 'terraform',        label: 'Terraform' },
  // Observability
  { kind: 'logo', slug: 'grafana',          label: 'Grafana' },
  { kind: 'logo', slug: 'prometheus',       label: 'Prometheus' },
  { kind: 'logo', slug: 'sentry',           label: 'Sentry' },
  // Source control / CI
  { kind: 'logo', slug: 'git',              label: 'Git' },
  { kind: 'logo', slug: 'github',           label: 'GitHub' },
  { kind: 'logo', slug: 'gitlab',           label: 'GitLab' },
  { kind: 'logo', slug: 'jenkins',          label: 'Jenkins' },
  { kind: 'logo', slug: 'githubactions',    label: 'GitHub Actions' },
  // Frontend frameworks
  { kind: 'logo', slug: 'react',            label: 'React' },
  { kind: 'logo', slug: 'vuedotjs',         label: 'Vue' },
  // IDEs / tools
  { kind: 'logo', slug: 'vscodium',         label: 'VSCodium (VS Code)' },
  { kind: 'logo', slug: 'jetbrains',        label: 'JetBrains' },
  { kind: 'logo', slug: 'pycharm',          label: 'PyCharm' },
  { kind: 'logo', slug: 'notion',           label: 'Notion' },
  { kind: 'logo', slug: 'slack',            label: 'Slack' },
];

export const ALL_ICONS = [...EMOJIS, ...LOGOS];

/** Returns the stored value for an icon entry. */
export function iconKey(entry) {
  if (entry.kind === 'emoji') return `emoji:${entry.chars}`;
  if (entry.kind === 'logo')  return `logo:${entry.slug}`;
  return `text:${entry.label}`;
}

/**
 * Renders an icon into the given container element.
 * Accepts either a prefixed key (`emoji:🗄`, `logo:python`, `text:DB`) or a
 * legacy bare string (treated as emoji/text).
 */
export function renderIcon(stored, container, { size = 14, color = 'currentColor' } = {}) {
  container.innerHTML = '';
  if (!stored) return;
  let kind, value;
  if (stored.startsWith('emoji:')) { kind = 'emoji'; value = stored.slice(6); }
  else if (stored.startsWith('logo:')) { kind = 'logo'; value = stored.slice(5); }
  else if (stored.startsWith('text:')) { kind = 'text'; value = stored.slice(5); }
  else { kind = 'text'; value = stored; }   // legacy bare emoji / text

  if (kind === 'logo') {
    const img = document.createElement('span');
    img.className = 'rs-logo-icon';
    img.style.cssText = `
      display:inline-block;
      width:${size}px;height:${size}px;
      background-color:${color};
      mask-image:url(icons/logos/${value}.svg);
      mask-size:contain;mask-repeat:no-repeat;mask-position:center;
      -webkit-mask-image:url(icons/logos/${value}.svg);
      -webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;
      vertical-align:middle;
    `.replace(/\s+/g, ' ');
    container.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = value;
    span.style.color = color;
    container.appendChild(span);
  }
}
