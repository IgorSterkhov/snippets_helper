import React from 'react';
import { Image, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

export function isSafeImageUrl(src) {
  if (!src || typeof src !== 'string') return false;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function hasMarkdownImage(text) {
  return /!\[[^\]]*]\(\s*https?:\/\/[^)\s]+/i.test(text || '');
}

export function imageCaption(node) {
  const alt = node?.attributes?.alt;
  if (alt && String(alt).trim()) return String(alt).trim();
  const src = node?.attributes?.src || '';
  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split('/').pop() || '';
    return name.replace(/\.[^.]+$/, '') || 'image';
  } catch {
    return 'image';
  }
}

export function createMarkdownFigureRules(colors) {
  return {
    image: (node) => {
      const src = node?.attributes?.src || '';
      if (!isSafeImageUrl(src)) return null;

      const caption = imageCaption(node);
      return (
        <View
          key={node.key}
          style={[
            figureStyles.card,
            { backgroundColor: colors.bgSecondary, borderColor: colors.border },
          ]}
        >
          <Image
            source={{ uri: src }}
            resizeMode="contain"
            style={figureStyles.image}
            accessible
            accessibilityLabel={caption}
          />
          <Text style={[figureStyles.caption, { color: colors.textSecondary }]} numberOfLines={2}>
            {caption}
          </Text>
        </View>
      );
    },
  };
}

export function createMarkdownStyles(colors) {
  return {
    body: { color: colors.text, fontSize: 15, lineHeight: 22 },
    text: { color: colors.text },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 14, marginBottom: 6 },
    heading3: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 12, marginBottom: 4 },
    code_block: {
      backgroundColor: colors.bgSecondary,
      color: colors.text,
      padding: 10,
      borderRadius: 6,
      fontFamily: 'monospace',
    },
    fence: {
      backgroundColor: colors.bgSecondary,
      color: colors.text,
      padding: 10,
      borderRadius: 6,
      fontFamily: 'monospace',
    },
    code_inline: {
      backgroundColor: colors.bgSecondary,
      color: colors.text,
      paddingHorizontal: 4,
      borderRadius: 3,
      fontFamily: 'monospace',
    },
    link: { color: colors.primary },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 12,
      color: colors.textSecondary,
    },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 16 },
  };
}

export default function MarkdownContent({ children, colors, style }) {
  return (
    <Markdown
      style={{ ...createMarkdownStyles(colors), ...(style || {}) }}
      rules={createMarkdownFigureRules(colors)}
    >
      {children || ''}
    </Markdown>
  );
}

const figureStyles = {
  card: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 8,
  },
  image: {
    width: '100%',
    height: 220,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
};
