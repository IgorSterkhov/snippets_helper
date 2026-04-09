import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { getAllSnippets, searchSnippets, getAllTags } from '../../db/snippetRepo';
import { performSync } from '../../sync/syncService';
import SearchBar from '../../components/SearchBar';
import TagFilter from '../../components/TagFilter';

export default function SnippetListScreen({ navigation }) {
  const { colors } = useTheme();
  const [snippets, setSnippets] = useState([]);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const t = await getAllTags();
    setTags(t);
    let items;
    if (query) {
      items = await searchSnippets(query);
    } else {
      items = await getAllSnippets();
    }
    if (selectedTag) {
      const tag = t.find((tg) => tg.uuid === selectedTag);
      if (tag) {
        const patterns = JSON.parse(tag.patterns || '[]');
        items = items.filter((s) =>
          patterns.some((p) => s.name.toLowerCase().includes(p.toLowerCase())),
        );
      }
    }
    setSnippets(items);
  }, [query, selectedTag]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await performSync();
      await loadData();
    } catch (e) {
      console.warn('Sync failed:', e);
    }
    setRefreshing(false);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigation.navigate('SnippetDetail', { snippet: item })}
    >
      <Text style={[s.name, { color: colors.text }]}>{item.name}</Text>
      {item.description ? (
        <Text style={[s.desc, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.description}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Поиск сниппетов..." />
      <TagFilter tags={tags} selectedId={selectedTag} onSelect={setSelectedTag} />
      <FlatList
        data={snippets}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={snippets.length === 0 ? s.empty : undefined}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center' }}>Нет сниппетов</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  card: { padding: 14, marginHorizontal: 12, marginVertical: 4, borderRadius: 8, borderWidth: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 13, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
