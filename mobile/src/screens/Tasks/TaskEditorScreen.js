import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import {
  deleteTask,
  flattenCheckboxTree,
  getAllTaskCategories,
  getAllTaskStatuses,
  getNextTaskSortOrder,
  getTaskCheckboxes,
  getTaskLinks,
  upsertTask,
  upsertTaskCheckbox,
  upsertTaskLink,
} from '../../db/taskRepo';
import { notifyLocalChange } from '../../sync/syncService';
import { uuidv4 } from '../../lib/uuid';

const COLORS = [null, '#fff8c5', '#dcffe4', '#ddf4ff', '#fbefff', '#ffeef0'];
const CHECKBOX_INDENT_STEP = 18;
const CHECKBOX_MAX_INDENT = 72;

function collectCheckboxSubtree(items, rootUuid) {
  const ids = new Set([rootUuid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parent_uuid && ids.has(item.parent_uuid) && !ids.has(item.uuid)) {
        ids.add(item.uuid);
        changed = true;
      }
    }
  }
  return ids;
}

export default function TaskEditorScreen({ route, navigation }) {
  const { task, isNew } = route.params;
  const { colors } = useTheme();
  const [categories, setCategories] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [draft, setDraft] = useState(task);
  const [checkboxes, setCheckboxes] = useState([]);
  const [links, setLinks] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadChildren = useCallback(async () => {
    const [cats, sts, checks, taskLinks] = await Promise.all([
      getAllTaskCategories(),
      getAllTaskStatuses(),
      getTaskCheckboxes(task.uuid),
      getTaskLinks(task.uuid),
    ]);
    setCategories(cats);
    setStatuses(sts);
    setCheckboxes(checks);
    setLinks(taskLinks);
  }, [task.uuid]);

  useFocusEffect(useCallback(() => { loadChildren(); }, [loadChildren]));

  const patchDraft = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      await upsertTask({ ...draft, updated_at: now, title: draft.title || 'Без названия' });
      for (const item of checkboxes) {
        await upsertTaskCheckbox({ ...item, updated_at: item.updated_at || now });
      }
      for (const item of links) {
        await upsertTaskLink({ ...item, updated_at: item.updated_at || now });
      }
      notifyLocalChange();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
      setSaving(false);
    }
  }, [checkboxes, draft, links, navigation, saving]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={save} disabled={saving} style={s.headerBtn}>
          <Text style={[s.headerBtnText, { color: saving ? colors.textMuted : colors.primary }]}>
            {saving ? 'Сохр…' : 'Сохранить'}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [colors, navigation, save, saving]);

  const addCheckbox = async () => {
    const now = new Date().toISOString();
    const sortOrder = await getNextTaskSortOrder('task_checkboxes', 'task_uuid', task.uuid);
    setCheckboxes((prev) => [...prev, {
      uuid: uuidv4(),
      task_uuid: task.uuid,
      parent_uuid: null,
      text: '',
      is_checked: 0,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    }]);
  };

  const addLink = async () => {
    const now = new Date().toISOString();
    const sortOrder = await getNextTaskSortOrder('task_links', 'task_uuid', task.uuid);
    setLinks((prev) => [...prev, {
      uuid: uuidv4(),
      task_uuid: task.uuid,
      url: '',
      label: '',
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    }]);
  };

  const removeTask = () => {
    if (isNew) {
      navigation.goBack();
      return;
    }
    Alert.alert('Удалить задачу?', draft.title || 'Без названия', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteTask(task.uuid);
          notifyLocalChange();
          navigation.goBack();
        },
      },
    ]);
  };

  const visibleCheckboxTree = flattenCheckboxTree(checkboxes);
  const visibleLinks = links.filter((item) => !item.is_deleted);

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content}>
        <TextInput
          style={[s.titleInput, { color: colors.text, borderColor: colors.border }]}
          value={draft.title}
          onChangeText={(title) => patchDraft({ title })}
          placeholder="Название задачи"
          placeholderTextColor={colors.textMuted}
        />

        <Section title="Категория" colors={colors}>
          <PickerRow items={categories} selected={draft.category_uuid} onSelect={(category_uuid) => patchDraft({ category_uuid })} colors={colors} />
        </Section>

        <Section title="Статус" colors={colors}>
          <PickerRow items={statuses} selected={draft.status_uuid} onSelect={(status_uuid) => patchDraft({ status_uuid })} colors={colors} />
        </Section>

        <Section title="Параметры" colors={colors}>
          <View style={s.switchRow}>
            <Text style={[s.label, { color: colors.text }]}>Pinned</Text>
            <Switch value={!!draft.is_pinned} onValueChange={(v) => patchDraft({ is_pinned: v ? 1 : 0 })} />
          </View>
          <TextInput
            style={[s.input, { color: colors.text, borderColor: colors.border }]}
            value={draft.tracker_url || ''}
            onChangeText={(tracker_url) => patchDraft({ tracker_url })}
            placeholder="Tracker URL"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <View style={s.palette}>
            {COLORS.map((color) => (
              <TouchableOpacity
                key={color || 'default'}
                style={[
                  s.swatch,
                  { backgroundColor: color || colors.card, borderColor: colors.border },
                  (draft.bg_color || null) === color && { borderColor: colors.primary, borderWidth: 2 },
                ]}
                onPress={() => patchDraft({ bg_color: color })}
              >
                {!color ? <Text style={{ color: colors.textMuted, fontSize: 10 }}>D</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Section title="Notes" colors={colors}>
          <TextInput
            style={[s.notes, { color: colors.text, borderColor: colors.border }]}
            value={draft.notes_md || ''}
            onChangeText={(notes_md) => patchDraft({ notes_md })}
            placeholder="Markdown notes"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />
        </Section>

        <Section title="Чекбоксы" colors={colors} action="Добавить" onAction={addCheckbox}>
          {visibleCheckboxTree.map(({ item, depth }) => (
            <View
              key={item.uuid}
              style={[
                s.itemRow,
                depth ? { paddingLeft: Math.min(depth * CHECKBOX_INDENT_STEP, CHECKBOX_MAX_INDENT) } : null,
              ]}
            >
              <TouchableOpacity
                style={[s.checkBox, { borderColor: colors.border }, item.is_checked && { backgroundColor: colors.primary }]}
                onPress={() => setCheckboxes((prev) => prev.map((c) => c.uuid === item.uuid ? { ...c, is_checked: c.is_checked ? 0 : 1, updated_at: new Date().toISOString() } : c))}
              >
                {item.is_checked ? <Text style={s.checkMark}>✓</Text> : null}
              </TouchableOpacity>
              <TextInput
                style={[s.flexInput, { color: colors.text, borderColor: colors.border }]}
                value={item.text}
                onChangeText={(text) => setCheckboxes((prev) => prev.map((c) => c.uuid === item.uuid ? { ...c, text, updated_at: new Date().toISOString() } : c))}
                placeholder="Пункт"
                placeholderTextColor={colors.textMuted}
              />
              <TextButton
                label="Del"
                color={colors.danger}
                onPress={() => {
                  const now = new Date().toISOString();
                  const deletedIds = collectCheckboxSubtree(checkboxes, item.uuid);
                  setCheckboxes((prev) => prev.map((c) => (
                    deletedIds.has(c.uuid) ? { ...c, is_deleted: 1, updated_at: now } : c
                  )));
                }}
              />
            </View>
          ))}
        </Section>

        <Section title="Ссылки" colors={colors} action="Добавить" onAction={addLink}>
          {visibleLinks.map((item) => (
            <View key={item.uuid} style={s.linkBlock}>
              <TextInput
                style={[s.input, { color: colors.text, borderColor: colors.border }]}
                value={item.label || ''}
                onChangeText={(label) => setLinks((prev) => prev.map((l) => l.uuid === item.uuid ? { ...l, label, updated_at: new Date().toISOString() } : l))}
                placeholder="Label"
                placeholderTextColor={colors.textMuted}
              />
              <View style={s.itemRow}>
                <TextInput
                  style={[s.flexInput, { color: colors.text, borderColor: colors.border }]}
                  value={item.url}
                  onChangeText={(url) => setLinks((prev) => prev.map((l) => l.uuid === item.uuid ? { ...l, url, updated_at: new Date().toISOString() } : l))}
                  placeholder="https://..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                <TextButton label="Del" color={colors.danger} onPress={() => setLinks((prev) => prev.map((l) => l.uuid === item.uuid ? { ...l, is_deleted: 1, updated_at: new Date().toISOString() } : l))} />
              </View>
            </View>
          ))}
        </Section>

        <TouchableOpacity style={[s.deleteBtn, { borderColor: colors.danger }]} onPress={removeTask}>
          <Text style={[s.deleteText, { color: colors.danger }]}>{isNew ? 'Отменить' : 'Удалить задачу'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children, colors, action, onAction }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color: colors.text }]}>{title}</Text>
        {action ? <TextButton label={action} color={colors.primary} onPress={onAction} /> : null}
      </View>
      {children}
    </View>
  );
}

function PickerRow({ items, selected, onSelect, colors }) {
  return (
    <View style={s.pickerRow}>
      <TextButton label="None" color={!selected ? colors.primary : colors.textSecondary} onPress={() => onSelect(null)} />
      {items.map((item) => (
        <TouchableOpacity
          key={item.uuid}
          style={[
            s.pickChip,
            { borderColor: item.color || colors.border },
            selected === item.uuid && { backgroundColor: colors.primaryLight },
          ]}
          onPress={() => onSelect(item.uuid)}
        >
          <Text style={{ color: selected === item.uuid ? colors.primary : colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
            {item.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function TextButton({ label, color, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  headerBtnText: { fontSize: 16, fontWeight: '600' },
  titleInput: { fontSize: 22, fontWeight: '700', borderBottomWidth: 1, paddingVertical: 10 },
  section: { marginTop: 18 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pickChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, marginBottom: 8 },
  flexInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  notes: { minHeight: 130, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 20 },
  palette: { flexDirection: 'row', gap: 8 },
  swatch: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  checkBox: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontWeight: '900' },
  linkBlock: { marginBottom: 10 },
  deleteBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 22 },
  deleteText: { fontWeight: '800' },
});
