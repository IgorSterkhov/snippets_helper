import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { getAllFolders, getNotesByFolder, getAllNotes, searchNotes } from '../../db/noteRepo';
import { performSync } from '../../sync/syncService';
import FolderTree from '../../components/FolderTree';
import SearchBar from '../../components/SearchBar';

export default function NoteListScreen({ navigation }) {
  const { colors } = useTheme();
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showFolders, setShowFolders] = useState(true);

  const loadFolders = useCallback(async () => {
    const f = await getAllFolders();
    setFolders(f);
  }, []);

  const loadNotes = useCallback(async () => {
    let items;
    if (query) {
      items = await searchNotes(query);
    } else if (selectedFolder) {
      items = await getNotesByFolder(selectedFolder);
    } else {
      items = await getAllNotes();
    }
    setNotes(items);
  }, [selectedFolder, query]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  useFocusEffect(useCallback(() => { loadFolders(); loadNotes(); }, [loadFolders, loadNotes]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await performSync();
      await loadFolders();
      await loadNotes();
    } catch (e) {
      console.warn('Sync failed:', e);
    }
    setRefreshing(false);
  };

  const renderNote = ({ item }) => (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigation.navigate('NoteEditor', { note: item })}
    >
      <View style={s.cardHeader}>
        <Text style={[s.noteTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        {item.is_pinned ? <Text style={s.pin}>📌</Text> : null}
      </View>
      {item.content ? (
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.content.substring(0, 100)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Поиск заметок..." />

      {!query && (
        <TouchableOpacity style={s.toggleFolders} onPress={() => setShowFolders(!showFolders)}>
          <Text style={{ color: colors.primary }}>{showFolders ? 'Скрыть папки' : 'Показать папки'}</Text>
        </TouchableOpacity>
      )}

      {!query && showFolders && (
        <View style={[s.folderPanel, { borderColor: colors.border }]}>
          <FolderTree folders={folders} selectedId={selectedFolder} onSelect={setSelectedFolder} />
        </View>
      )}

      <FlatList
        data={notes}
        keyExtractor={(item) => item.uuid}
        renderItem={renderNote}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={notes.length === 0 ? s.empty : undefined}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center' }}>Нет заметок</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  folderPanel: { maxHeight: 200, borderBottomWidth: 1, marginBottom: 4 },
  toggleFolders: { paddingHorizontal: 12, paddingVertical: 4 },
  card: { padding: 14, marginHorizontal: 12, marginVertical: 4, borderRadius: 8, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noteTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  pin: { fontSize: 14, marginLeft: 8 },
  preview: { fontSize: 13, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
