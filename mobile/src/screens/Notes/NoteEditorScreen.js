import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../../theme/ThemeContext';
import { upsertNote } from '../../db/noteRepo';
import { notifyLocalChange } from '../../sync/syncService';

export default function NoteEditorScreen({ route, navigation }) {
  const { note } = route.params;
  const { colors } = useTheme();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await upsertNote({
      ...note,
      title,
      content,
      updated_at: new Date().toISOString(),
    });
    notifyLocalChange();
    setSaving(false);
    navigation.goBack();
  };

  const mdStyles = {
    body: { color: colors.text, fontSize: 14 },
    heading1: { color: colors.text },
    heading2: { color: colors.text },
    heading3: { color: colors.text },
    code_block: { backgroundColor: colors.bgSecondary, color: colors.text },
    code_inline: { backgroundColor: colors.bgSecondary, color: colors.text },
    link: { color: colors.primary },
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <TextInput
        style={[s.titleInput, { color: colors.text, borderColor: colors.border }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Заголовок"
        placeholderTextColor={colors.textMuted}
      />

      <View style={s.toolbar}>
        <TouchableOpacity onPress={() => setPreview(!preview)}>
          <Text style={{ color: colors.primary }}>{preview ? 'Редактировать' : 'Превью'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{saving ? 'Сохранение...' : 'Сохранить'}</Text>
        </TouchableOpacity>
      </View>

      {preview ? (
        <ScrollView style={s.previewArea}>
          <Markdown style={mdStyles}>{content}</Markdown>
        </ScrollView>
      ) : (
        <TextInput
          style={[s.editor, { color: colors.text, backgroundColor: colors.bgSecondary }]}
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholder="Содержимое (markdown)"
          placeholderTextColor={colors.textMuted}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  titleInput: { fontSize: 18, fontWeight: '600', borderBottomWidth: 1, paddingVertical: 8, marginBottom: 8 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  editor: { flex: 1, fontSize: 14, fontFamily: 'monospace', padding: 12, borderRadius: 8 },
  previewArea: { flex: 1 },
});
