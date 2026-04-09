import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function TagFilter({ tags, selectedId, onSelect }) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.container}>
      <TouchableOpacity
        style={[s.tag, { backgroundColor: !selectedId ? colors.primary : colors.bgSecondary, borderColor: colors.border }]}
        onPress={() => onSelect(null)}
      >
        <Text style={[s.tagText, { color: !selectedId ? '#fff' : colors.text }]}>Все</Text>
      </TouchableOpacity>
      {tags.map((tag) => (
        <TouchableOpacity
          key={tag.uuid}
          style={[
            s.tag,
            {
              backgroundColor: selectedId === tag.uuid ? tag.color : colors.bgSecondary,
              borderColor: tag.color,
            },
          ]}
          onPress={() => onSelect(tag.uuid === selectedId ? null : tag.uuid)}
        >
          <Text style={[s.tagText, { color: selectedId === tag.uuid ? '#fff' : colors.text }]}>
            {tag.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingVertical: 6 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, borderWidth: 1 },
  tagText: { fontSize: 13 },
});
