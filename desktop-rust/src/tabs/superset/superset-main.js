import { TabContainer } from '../../components/tab-container.js';

export function init(container) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.height = '100%';
  wrap.style.width = '100%';
  container.appendChild(wrap);

  const tabs = [
    { id: 'export',   label: 'Export',   icon: '\uD83D\uDCC2', loader: el => import('./export.js').then(m => m.init(el)) },
    { id: 'validate', label: 'Validate', icon: '\u2705',       loader: el => import('./validate.js').then(m => m.init(el)) },
    { id: 'sql',      label: 'SQL',      icon: '\uD83D\uDDC3', loader: el => import('./sql.js').then(m => m.init(el)) },
  ];

  const tc = new TabContainer(wrap, tabs);
  tc.activate('export');
}
