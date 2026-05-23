import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import {
  deleteTaskCategory,
  deleteTaskStatus,
  getAllTaskCategories,
  getAllTaskStatuses,
  getNextTaskSortOrder,
  upsertTaskCategory,
  upsertTaskStatus,
} from '../../db/taskRepo';
import { notifyLocalChange } from '../../sync/syncService';
import { uuidv4 } from '../../lib/uuid';

const DEFAULT_COLORS = ['#8b949e', '#388bfd', '#3fb950', '#d29922', '#f85149', '#a371f7'];

export default function TaskManageScreen({ navigation }) {
  const { colors } = useTheme();
  const [categories, setCategories] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [cats, sts] = await Promise.all([getAllTaskCategories(), getAllTaskStatuses()]);
    setCategories(cats);
    setStatuses(sts);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      for (const item of categories) await upsertTaskCategory({ ...item, updated_at: item.updated_at || new Date().toISOString() });
      for (const item of statuses) await upsertTaskStatus({ ...item, updated_at: item.updated_at || new Date().toISOString() });
      notifyLocalChange();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
      setSaving(false);
    }
  }, [categories, navigation, saving, statuses]);

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

  const addCategory = async () => {
    const now = new Date().toISOString();
    const sortOrder = await getNextTaskSortOrder('task_categories');
    setCategories((prev) => [...prev, {
      uuid: uuidv4(),
      name: 'New category',
      color: '#8b949e',
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    }]);
  };

  const addStatus = async () => {
    const now = new Date().toISOString();
    const sortOrder = await getNextTaskSortOrder('task_statuses');
    setStatuses((prev) => [...prev, {
      uuid: uuidv4(),
      name: 'New status',
      color: '#8b949e',
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
    }]);
  };

  return (
    <ScrollView style={[s.container, { backgroundColor: colors.bg }]} contentContainerStyle={s.content}>
      <ManageSection
        title="Категории"
        items={categories}
        setItems={setCategories}
        onAdd={addCategory}
        onDelete={deleteTaskCategory}
        colors={colors}
      />
      <ManageSection
        title="Статусы"
        items={statuses}
        setItems={setStatuses}
        onAdd={addStatus}
        onDelete={deleteTaskStatus}
        colors={colors}
      />
    </ScrollView>
  );
}

function ManageSection({ title, items, setItems, onAdd, onDelete, colors }) {
  const visible = items.filter((item) => !item.is_deleted);

  const patch = (uuid, change) => {
    setItems((prev) => prev.map((item) => (
      item.uuid === uuid ? { ...item, ...change, updated_at: new Date().toISOString() } : item
    )));
  };

  const remove = (item) => {
    Alert.alert('Удалить?', item.name, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          if (item.created_at && item.created_at === item.updated_at) {
            setItems((prev) => prev.filter((row) => row.uuid !== item.uuid));
          } else {
            await onDelete(item.uuid);
            setItems((prev) => prev.map((row) => (
              row.uuid === item.uuid ? { ...row, is_deleted: 1, updated_at: new Date().toISOString() } : row
            )));
            notifyLocalChange();
          }
        },
      },
    ]);
  };

  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color: colors.text }]}>{title}</Text>
        <TouchableOpacity onPress={onAdd}>
          <Text style={[s.addText, { color: colors.primary }]}>Добавить</Text>
        </TouchableOpacity>
      </View>

      {visible.map((item) => (
        <View key={item.uuid} style={[s.row, { borderColor: colors.border }]}>
          <TextInput
            style={[s.nameInput, { color: colors.text }]}
            value={item.name}
            onChangeText={(name) => patch(item.uuid, { name })}
            placeholder="Name"
            placeholderTextColor={colors.textMuted}
          />
          <View style={s.palette}>
            {DEFAULT_COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  s.swatch,
                  { backgroundColor: color, borderColor: item.color === color ? colors.primary : colors.border },
                  item.color === color && { borderWidth: 2 },
                ]}
                onPress={() => patch(item.uuid, { color })}
              />
            ))}
          </View>
          <TouchableOpacity onPress={() => remove(item)} style={s.deleteBtn}>
            <Text style={{ color: colors.danger, fontWeight: '800' }}>Удалить</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!visible.length ? <Text style={[s.empty, { color: colors.textMuted }]}>Пусто</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  headerBtnText: { fontSize: 16, fontWeight: '600' },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  addText: { fontSize: 14, fontWeight: '700' },
  row: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10 },
  nameInput: { fontSize: 15, fontWeight: '700', paddingVertical: 6 },
  palette: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  swatch: { width: 28, height: 28, borderRadius: 7, borderWidth: 1 },
  deleteBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 18 },
});
