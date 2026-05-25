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
import Clipboard from '@react-native-clipboard/clipboard';
import MarkdownContent from '../../components/MarkdownContent';
import ShareLinkSheet from '../../components/ShareLinkSheet';
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
  const [shareVisible, setShareVisible] = useState(false);

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
        <View style={s.headerActions}>
          <TouchableOpacity
            onPress={() => setShareVisible(true)}
            style={s.headerIconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
          >
            <Text style={{ color: colors.primary, fontSize: 18 }}>🔗</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={s.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
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
        </View>
      ),
    });
  }, [navigation, save, saving, colors]);

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

      <View style={s.editorControls}>
        <View style={[s.segmented, { backgroundColor: colors.bgSecondary }]}>
          <Segment label="Написать" active={!preview} onPress={() => setPreview(false)} colors={colors} />
          <Segment label="Превью" active={preview} onPress={() => setPreview(true)} colors={colors} />
        </View>
        <TouchableOpacity
          style={[s.copyBtn, { borderColor: colors.border }]}
          onPress={() => {
            Clipboard.setString(content || '');
            Alert.alert('Скопировано', 'Текст заметки скопирован');
          }}
          activeOpacity={0.85}
        >
          <Text style={[s.copyBtnText, { color: colors.primary }]}>Copy</Text>
        </TouchableOpacity>
      </View>

      {preview ? (
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {content.trim() ? (
            <MarkdownContent colors={colors}>{content}</MarkdownContent>
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
      <ShareLinkSheet
        visible={shareVisible}
        itemType="note"
        itemUuid={note.uuid}
        onClose={() => setShareVisible(false)}
      />
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
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  headerBtnText: { fontSize: 16, fontWeight: '600' },
  titleInput: {
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  editorControls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  segmented: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 7,
  },
  segmentText: { fontSize: 14, fontWeight: '600' },
  copyBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  copyBtnText: { fontSize: 14, fontWeight: '600' },
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
