import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import {
  getAllTaskCategories,
  getAllTaskStatuses,
  getTaskCheckboxes,
  getTasksByFilters,
  getNextTaskSortOrder,
} from '../../db/taskRepo';
import { performSync } from '../../sync/syncService';
import SearchBar from '../../components/SearchBar';
import SyncStatusBar from '../../components/SyncStatusBar';
import { uuidv4 } from '../../lib/uuid';

export default function TaskListScreen({ navigation }) {
  const { colors } = useTheme();
  const [categories, setCategories] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [progress, setProgress] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [cats, sts] = await Promise.all([getAllTaskCategories(), getAllTaskStatuses()]);
    setCategories(cats);
    setStatuses(sts);
    const items = await getTasksByFilters(selectedCategory, selectedStatus, query);
    setTasks(items);
    const pairs = await Promise.all(items.map(async (task) => {
      const checks = await getTaskCheckboxes(task.uuid);
      const done = checks.filter((c) => c.is_checked).length;
      return [task.uuid, { done, total: checks.length }];
    }));
    setProgress(Object.fromEntries(pairs));
  }, [query, selectedCategory, selectedStatus]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await performSync();
      await loadData();
    } catch (e) {
      console.warn('Task sync failed:', e);
    }
    setRefreshing(false);
  };

  const createTask = async () => {
    const now = new Date().toISOString();
    const sortOrder = await getNextTaskSortOrder('tasks');
    navigation.navigate('TaskEditor', {
      task: {
        uuid: uuidv4(),
        title: '',
        category_uuid: selectedCategory,
        status_uuid: selectedStatus,
        is_pinned: 0,
        bg_color: null,
        tracker_url: '',
        notes_md: '',
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
        is_deleted: 0,
      },
      isNew: true,
    });
  };

  const categoryById = Object.fromEntries(categories.map((c) => [c.uuid, c]));
  const statusById = Object.fromEntries(statuses.map((s) => [s.uuid, s]));

  const renderTask = ({ item }) => {
    const cat = categoryById[item.category_uuid];
    const st = statusById[item.status_uuid];
    const p = progress[item.uuid] || { done: 0, total: 0 };
    return (
      <TouchableOpacity
        style={[s.card, { backgroundColor: item.bg_color || colors.card, borderColor: colors.border }]}
        onPress={() => navigation.navigate('TaskEditor', { task: item, isNew: false })}
      >
        <View style={s.cardHeader}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{item.title || 'Без названия'}</Text>
          {item.is_pinned ? <Text style={s.pin}>PIN</Text> : null}
        </View>
        <View style={s.metaRow}>
          {cat ? <Chip label={cat.name} color={cat.color} /> : null}
          {st ? <Chip label={st.name} color={st.color} /> : null}
          {p.total ? <Text style={[s.progress, { color: colors.textSecondary }]}>{p.done}/{p.total}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <SyncStatusBar />
      <View style={s.headerRow}>
        <Text style={[s.heading, { color: colors.text }]}>Tasks</Text>
        <TouchableOpacity onPress={() => navigation.navigate('TaskManage')}>
          <Text style={[s.manage, { color: colors.primary }]}>Списки</Text>
        </TouchableOpacity>
      </View>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Поиск задач..." />
      <FilterRow
        label="Категории"
        items={categories}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
        colors={colors}
      />
      <FilterRow
        label="Статусы"
        items={statuses}
        selected={selectedStatus}
        onSelect={setSelectedStatus}
        colors={colors}
      />
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.uuid}
        renderItem={renderTask}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={tasks.length === 0 ? s.empty : { paddingBottom: 80 }}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center' }}>Нет задач</Text>}
      />
      <TouchableOpacity style={[s.fab, { backgroundColor: colors.primary }]} onPress={createTask} activeOpacity={0.8}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function FilterRow({ label, items, selected, onSelect, colors }) {
  return (
    <View style={s.filterBlock}>
      <Text style={[s.filterLabel, { color: colors.textMuted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        <TouchableOpacity
          style={[s.filterChip, { borderColor: colors.border }, !selected && { backgroundColor: colors.primaryLight }]}
          onPress={() => onSelect(null)}
        >
          <Text style={[s.filterText, { color: !selected ? colors.primary : colors.textSecondary }]}>Все</Text>
        </TouchableOpacity>
        {items.map((item) => (
          <TouchableOpacity
            key={item.uuid}
            style={[
              s.filterChip,
              { borderColor: item.color || colors.border },
              selected === item.uuid && { backgroundColor: colors.primaryLight },
            ]}
            onPress={() => onSelect(item.uuid)}
          >
            <Text style={[s.filterText, { color: selected === item.uuid ? colors.primary : colors.textSecondary }]}>
              {item.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({ label, color }) {
  return (
    <View style={[s.chip, { borderColor: color || '#8b949e' }]}>
      <Text style={[s.chipText, { color: color || '#8b949e' }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10 },
  heading: { fontSize: 22, fontWeight: '700' },
  manage: { fontSize: 15, fontWeight: '600' },
  filterBlock: { marginTop: 6 },
  filterLabel: { fontSize: 11, fontWeight: '700', marginHorizontal: 12, marginBottom: 4, textTransform: 'uppercase' },
  filterRow: { paddingHorizontal: 12, gap: 8 },
  filterChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  filterText: { fontSize: 13, fontWeight: '600' },
  card: { padding: 14, marginHorizontal: 12, marginVertical: 5, borderRadius: 8, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '700' },
  pin: { fontSize: 10, fontWeight: '800', color: '#d29922' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 140 },
  chipText: { fontSize: 12, fontWeight: '600' },
  progress: { fontSize: 12, marginLeft: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 30, fontWeight: '400' },
});
