import React, { useState, useLayoutEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
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

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await upsertNote({
        ...note,
        title,
        content,
        updated_at: new Date().toISOString(),
      });
      notifyLocalChange();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
      setSaving(false);
    }
  }, [saving, title, content, note, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={s.headerBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text
            style={[
              s.headerBtnText,
              { color: saving ? colors.textMuted : colors.primary },
            ]}
          >
            {saving ? 'Сохр…' : 'Сохранить'}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, save, saving, colors]);

  const mdStyles = {
    body: { color: colors.text, fontSize: 15, lineHeight: 22 },
    heading1: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 14, marginBottom: 6 },
    heading3: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 12, marginBottom: 4 },
    code_block: { backgroundColor: colors.bgSecondary, color: colors.text, padding: 10, borderRadius: 6 },
    code_inline: { backgroundColor: colors.bgSecondary, color: colors.text, paddingHorizontal: 4, borderRadius: 3 },
    link: { color: colors.primary },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 12, color: colors.textSecondary },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 16 },
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TextInput
        style={[s.titleInput, { color: colors.text }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Заголовок"
        placeholderTextColor={colors.textMuted}
      />

      <View style={[s.segmented, { backgroundColor: colors.bgSecondary }]}>
        <Segment label="Написать" active={!preview} onPress={() => setPreview(false)} colors={colors} />
        <Segment label="Превью" active={preview} onPress={() => setPreview(true)} colors={colors} />
      </View>

      {preview ? (
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {content.trim() ? (
            <Markdown style={mdStyles}>{content}</Markdown>
          ) : (
            <Text style={[s.placeholder, { color: colors.textMuted }]}>
              Пусто — переключись во «Написать»
            </Text>
          )}
        </ScrollView>
      ) : (
        <TextInput
          style={[s.editor, { color: colors.text }]}
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholder="Начните писать…"
          placeholderTextColor={colors.textMuted}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function Segment({ label, active, onPress, colors }) {
  return (
    <TouchableOpacity
      style={[
        s.segment,
        active && {
          backgroundColor: colors.bg,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.12,
          shadowRadius: 2,
          elevation: 2,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[s.segmentText, { color: active ? colors.text : colors.textMuted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  headerBtnText: { fontSize: 16, fontWeight: '600' },
  titleInput: {
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 7,
  },
  segmentText: { fontSize: 14, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { paddingVertical: 8, paddingBottom: 40 },
  editor: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 2,
    paddingVertical: 8,
    paddingBottom: 40,
  },
  placeholder: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingTop: 24 },
});
