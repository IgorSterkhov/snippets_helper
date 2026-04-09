import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeContext';

export default function SnippetDetailScreen({ route }) {
  const { snippet } = route.params;
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    Clipboard.setString(snippet.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareSnippet = () => {
    Share.share({ message: snippet.value, title: snippet.name });
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <Text style={[s.title, { color: colors.text }]}>{snippet.name}</Text>

      {snippet.description ? (
        <Text style={[s.desc, { color: colors.textSecondary }]}>{snippet.description}</Text>
      ) : null}

      <ScrollView style={[s.codeBox, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        <Text style={[s.code, { color: colors.text }]} selectable>{snippet.value}</Text>
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={copyToClipboard}>
          <Text style={s.btnText}>{copied ? 'Скопировано!' : 'Копировать'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.bgTertiary }]} onPress={shareSnippet}>
          <Text style={[s.btnText, { color: colors.text }]}>Поделиться</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  desc: { fontSize: 14, marginBottom: 16 },
  codeBox: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16 },
  code: { fontSize: 14, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
});
