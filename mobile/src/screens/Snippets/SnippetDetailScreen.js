import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import MarkdownContent, { hasMarkdownImage } from '../../components/MarkdownContent';
import ShareLinkSheet from '../../components/ShareLinkSheet';
import { useTheme } from '../../theme/ThemeContext';

export default function SnippetDetailScreen({ route }) {
  const { snippet } = route.params;
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const valueHasImage = hasMarkdownImage(snippet.value);

  const copyToClipboard = () => {
    Clipboard.setString(snippet.value || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <Text style={[s.title, { color: colors.text }]}>{snippet.name}</Text>

      {snippet.description ? (
        <View style={s.desc}>
          <MarkdownContent colors={colors}>{snippet.description}</MarkdownContent>
        </View>
      ) : null}

      <ScrollView style={[s.codeBox, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        {valueHasImage ? (
          <MarkdownContent colors={colors}>{snippet.value}</MarkdownContent>
        ) : (
          <Text style={[s.code, { color: colors.text }]} selectable>{snippet.value}</Text>
        )}
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={copyToClipboard}>
          <Text style={s.btnText}>{copied ? 'Скопировано!' : 'Копировать'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.iconBtn, { backgroundColor: colors.bgTertiary }]}
          onPress={() => setShareVisible(true)}
          activeOpacity={0.85}
        >
          <Text style={[s.iconText, { color: colors.text }]}>🔗</Text>
        </TouchableOpacity>
      </View>
      <ShareLinkSheet
        visible={shareVisible}
        itemType="shortcut"
        itemUuid={snippet.uuid}
        onClose={() => setShareVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  desc: { marginBottom: 16 },
  codeBox: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16 },
  code: { fontSize: 14, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  iconBtn: { width: 52, padding: 14, borderRadius: 8, alignItems: 'center' },
  iconText: { fontSize: 18, fontWeight: '600' },
  btnText: { color: '#fff', fontWeight: '600' },
});
