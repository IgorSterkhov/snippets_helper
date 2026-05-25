import React from 'react';
import { render } from '@testing-library/react-native';
import {
  default as MarkdownContent,
  hasMarkdownImage,
  imageCaption,
  isSafeImageUrl,
} from '../../src/components/MarkdownContent';

const colors = {
  bg: '#111111',
  bgSecondary: '#222222',
  border: '#333333',
  text: '#eeeeee',
  textSecondary: '#bbbbbb',
  textMuted: '#777777',
  primary: '#0a84ff',
};

describe('MarkdownContent image helpers', () => {
  test('allows only http image URLs', () => {
    expect(isSafeImageUrl('https://ister-app.ru/snippets-media/a.webp')).toBe(true);
    expect(isSafeImageUrl('http://example.com/a.webp')).toBe(true);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('file:///tmp/a.webp')).toBe(false);
    expect(isSafeImageUrl('')).toBe(false);
  });

  test('detects markdown image syntax for snippet value rendering', () => {
    expect(hasMarkdownImage('![screen](https://ister-app.ru/snippets-media/a.webp)')).toBe(true);
    expect(hasMarkdownImage('plain text https://ister-app.ru/snippets-media/a.webp')).toBe(false);
  });

  test('uses alt text or file name as figure caption', () => {
    expect(imageCaption({ attributes: { alt: 'Diagram', src: 'https://x/y.webp' } })).toBe('Diagram');
    expect(imageCaption({ attributes: { alt: '', src: 'https://x/path/readable.webp' } })).toBe('readable');
  });

  test('renders image markdown as a figure with caption text', () => {
    const view = render(
      <MarkdownContent colors={colors}>
        {'![Readable screenshot](https://ister-app.ru/snippets-media/x.webp)'}
      </MarkdownContent>,
    );
    expect(view.getByText('Readable screenshot')).toBeTruthy();
  });
});
