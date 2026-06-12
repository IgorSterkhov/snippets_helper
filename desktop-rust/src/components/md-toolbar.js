/**
 * Reusable Markdown toolbar component.
 * Attaches a formatting toolbar above any <textarea>.
 *
 * Usage:
 *   import { attachToolbar } from '../components/md-toolbar.js';
 *   const toolbar = attachToolbar(myTextarea);
 */

import { openImageUploadModal } from './image-upload-modal.js';
import { openHtmlUploadModal } from './html-upload-modal.js';

// ── Core helpers ──────────────────────────────────────────────

function wrapSelection(textarea, before, after = '') {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const replacement = before + (selected || 'text') + after;
  textarea.setRangeText(replacement, start, end, 'select');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function prefixLines(textarea, prefix) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = textarea.value.indexOf('\n', end);
  const actualEnd = lineEnd === -1 ? textarea.value.length : lineEnd;
  const lines = textarea.value.substring(lineStart, actualEnd).split('\n');
  const prefixed = lines.map((line, i) => {
    if (prefix === '1. ') return `${i + 1}. ${line}`;
    return prefix + line;
  }).join('\n');
  textarea.setRangeText(prefixed, lineStart, actualEnd, 'select');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggleQuoteLines(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const { lineStart, lineEnd } = getLineBounds(textarea, start, end);
  const block = textarea.value.substring(lineStart, lineEnd);
  const lines = block.split('\n');
  const meaningful = lines.filter(line => line.trim().length > 0);
  const shouldUnquote = meaningful.length > 0
    && meaningful.every(line => /^(\s*)>\s?/.test(line));
  let selectionDelta = 0;
  const replacement = lines.map((line) => {
    if (shouldUnquote) {
      const next = line.replace(/^(\s*)>\s?/, '$1');
      selectionDelta += next.length - line.length;
      return next;
    }
    if (line.trim().length === 0) return line;
    selectionDelta += 2;
    return `> ${line}`;
  }).join('\n');

  textarea.setRangeText(replacement, lineStart, lineEnd, 'select');
  const nextEnd = Math.max(lineStart, lineEnd + selectionDelta);
  textarea.setSelectionRange(lineStart, nextEnd);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  textarea.setRangeText(text, start, start, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function getLineBounds(textarea, start, end) {
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = value.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  return { lineStart, lineEnd };
}

function selectionCoversWholeLines(textarea, start, end) {
  if (start === end) return false;
  const value = textarea.value;
  const selected = value.substring(start, end);
  if (selected.includes('\n')) return true;
  const { lineStart, lineEnd } = getLineBounds(textarea, start, end);
  return start === lineStart && end === lineEnd;
}

function insertCodeBlock(textarea) {
  const start = textarea.selectionStart;
  const text = '```\n\n```';
  textarea.setRangeText(text, start, start, 'end');
  textarea.setSelectionRange(start + 4, start + 4);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggleCodeFormatting(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) {
    insertCodeBlock(textarea);
    return;
  }

  const selected = textarea.value.substring(start, end);
  if (selectionCoversWholeLines(textarea, start, end)) {
    const { lineStart, lineEnd } = getLineBounds(textarea, start, end);
    const block = textarea.value.substring(lineStart, lineEnd);
    textarea.setRangeText('```\n' + block + '\n```', lineStart, lineEnd, 'select');
  } else if (selected.includes('\n')) {
    textarea.setRangeText('```\n' + selected + '\n```', start, end, 'select');
  } else {
    textarea.setRangeText('`' + selected + '`', start, end, 'select');
  }

  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Accepts http(s)://, ftp://, mailto:, www.* — rejects anything with
// whitespace or newlines, so pasted prose never ends up inside (…).
function looksLikeUrl(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  return /^(https?:\/\/|ftp:\/\/|mailto:|www\.)\S+$/i.test(t);
}

async function readUrlFromClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    if (t && looksLikeUrl(t)) return t.trim();
  } catch { /* permission denied / unavailable */ }
  return '';
}

// ── Button definitions ────────────────────────────────────────

function getButtons(textarea, options = {}) {
  let headingLevel = 1;

  return [
    {
      label: 'B', title: 'Bold',
      action: () => wrapSelection(textarea, '**', '**'),
    },
    {
      label: 'I', title: 'Italic', style: 'font-style:italic',
      action: () => wrapSelection(textarea, '*', '*'),
    },
    {
      label: 'S', title: 'Strikethrough', style: 'text-decoration:line-through',
      action: () => wrapSelection(textarea, '~~', '~~'),
    },
    {
      label: '</>', title: 'Code block',
      action: () => toggleCodeFormatting(textarea),
    },
    'sep',
    {
      label: 'H\u25BE', title: 'Heading (cycle #/##/###)',
      action: () => {
        const prefix = '#'.repeat(headingLevel) + ' ';
        prefixLines(textarea, prefix);
        headingLevel = (headingLevel % 3) + 1;
      },
    },
    {
      label: '\uD83D\uDD17', title: 'Link (URL from clipboard if it looks like one)',
      action: async () => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        const linkText = selected || 'link text';
        const url = await readUrlFromClipboard();
        const replacement = `[${linkText}](${url})`;
        textarea.setRangeText(replacement, start, end, 'end');
        textarea.focus();
        if (!url) {
          const caret = start + linkText.length + 3; // past "[text]("
          textarea.setSelectionRange(caret, caret);
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      },
    },
    {
      label: '\uD83D\uDDBC', title: 'Image',
      action: () => {
        if (options.enableImageUpload) {
          openImageUploadModal({
            onInsert: (markdown) => insertAtCursor(textarea, markdown),
          });
          return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        const url = prompt('Image URL:', 'https://');
        if (url === null) return;
        const alt = selected || 'alt';
        const replacement = `![${alt}](${url})`;
        textarea.setRangeText(replacement, start, end, 'select');
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      },
    },
    {
      label: 'HTML', title: 'Insert HTML from file',
      action: () => {
        if (!options.enableImageUpload) return;
        openHtmlUploadModal({
          onInsert: (markdown) => insertAtCursor(textarea, markdown),
        });
      },
    },
    'sep',
    {
      label: '\u2022', title: 'Bullet list',
      action: () => prefixLines(textarea, '- '),
    },
    {
      label: '1.', title: 'Numbered list',
      action: () => prefixLines(textarea, '1. '),
    },
    {
      label: '\u2610', title: 'Checkbox',
      action: () => prefixLines(textarea, '- [ ] '),
    },
    {
      label: '>', title: 'Quote',
      action: () => toggleQuoteLines(textarea),
    },
    'sep',
    {
      label: '\u2014', title: 'Horizontal rule',
      action: () => insertAtCursor(textarea, '\n---\n'),
    },
    {
      label: '\u229E', title: 'Table',
      action: () => {
        const table = '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |';
        insertAtCursor(textarea, '\n' + table + '\n');
      },
    },
  ];
}

// ── Public API ────────────────────────────────────────────────

export function attachToolbar(textarea, options = {}) {
  const toolbar = document.createElement('div');
  toolbar.className = 'md-toolbar';

  const buttons = getButtons(textarea, options);

  for (const btn of buttons) {
    if (btn === 'sep') {
      const sep = document.createElement('span');
      sep.className = 'sep';
      toolbar.appendChild(sep);
      continue;
    }

    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = btn.label;
    el.title = btn.title || '';
    if (btn.style) el.setAttribute('style', btn.style);
    el.addEventListener('click', (e) => {
      e.preventDefault();
      btn.action();
    });
    toolbar.appendChild(el);
  }

  // Paste-over-selection shortcut: if the user has text selected and the
  // clipboard holds what looks like a URL, transform the paste into a
  // Markdown link — same output as the 🔗 toolbar button. Anything else
  // (no selection, or non-URL clipboard) falls through to a normal paste.
  textarea.addEventListener('paste', (e) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const pasted = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!pasted || !looksLikeUrl(pasted)) return;
    e.preventDefault();
    const selected = textarea.value.substring(start, end);
    const replacement = `[${selected}](${pasted.trim()})`;
    textarea.setRangeText(replacement, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Insert toolbar before textarea
  textarea.parentNode.insertBefore(toolbar, textarea);

  // Remove top border-radius from textarea so it connects with toolbar
  textarea.style.borderTopLeftRadius = '0';
  textarea.style.borderTopRightRadius = '0';

  return toolbar;
}
