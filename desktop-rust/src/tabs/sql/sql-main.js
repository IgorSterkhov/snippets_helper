import { TabContainer } from '../../components/tab-container.js';

export function init(container) {
  container.innerHTML = '';

  // Wrap in a flex container that fills the panel
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.height = '100%';
  wrap.style.width = '100%';
  container.appendChild(wrap);

  const tabs = [
    { id: 'parser',     label: 'Parser',     icon: '\uD83D\uDD0D', loader: el => import('./parser.js').then(m => m.init(el)) },
    { id: 'analyzer',   label: 'Analyzer',   icon: '\uD83D\uDCCA', loader: el => import('./analyzer.js').then(m => m.init(el)) },
    { id: 'macrosing',  label: 'Macrosing',  icon: '\uD83D\uDD04', loader: el => import('./macrosing.js').then(m => m.init(el)) },
    { id: 'formatter',  label: 'Format',     icon: '\u2728',       loader: el => import('./formatter.js').then(m => m.init(el)) },
    { id: 'obfuscator', label: 'Obfuscate',  icon: '\uD83D\uDD12', loader: el => import('./obfuscator.js').then(m => m.init(el)) },
  ];

  const tc = new TabContainer(wrap, tabs);
  tc.activate('parser');
}
