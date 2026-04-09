import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function SearchBar({ value, onChangeText, placeholder = 'Поиск...' }) {
  const { colors } = useTheme();
  return (
    <View style={[s.container, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
      <TextInput
        style={[s.input, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, marginHorizontal: 12, marginVertical: 8 },
  input: { fontSize: 15, paddingVertical: 10 },
});
