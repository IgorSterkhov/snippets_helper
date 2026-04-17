import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useSyncStatus } from '../sync/useSyncStatus';
import { performSync } from '../sync/syncService';

export default function SyncStatusBar() {
  const { colors } = useTheme();
  const { pending, syncing } = useSyncStatus();

  if (!pending && !syncing) return null;

  const onPress = () => {
    performSync().catch(() => {});
  };

  return (
    <TouchableOpacity
      style={[s.container, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {syncing ? (
        <>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[s.text, { color: colors.textSecondary }]}>Синхронизация…</Text>
        </>
      ) : (
        <>
          <Text style={[s.badge, { color: colors.primary }]}>↑ {pending}</Text>
          <Text style={[s.text, { color: colors.textSecondary }]}>
            {pending === 1 ? 'изменение' : 'изменений'} ожидает
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badge: { fontSize: 13, fontWeight: '600' },
  text: { fontSize: 12 },
});
