import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { isBiometricAvailable } from '../../auth/biometrics';
import { performSync } from '../../sync/syncService';
import { useSyncStatus } from '../../sync/useSyncStatus';

export default function SettingsScreen() {
  const { colors, isDark, toggle: toggleTheme } = useTheme();
  const { logout, biometricEnabled, toggleBiometric } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const { pending, syncing } = useSyncStatus();

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
  }, []);

  const handleSync = async () => {
    try {
      await performSync();
      Alert.alert('Синхронизация', 'Данные синхронизированы');
    } catch (e) {
      Alert.alert('Ошибка синхронизации', String(e?.message || e));
    }
  };

  const handleCheckUpdate = async () => {
    try {
      const { checkForUpdate, applyUpdate, setOnProgress } = require('../../updater/updateService');
      const update = await checkForUpdate(true);
      if (update) {
        Alert.alert(
          'Обновление доступно',
          `Версия ${update.version}\n${update.release_notes || ''}`,
          [
            { text: 'Позже', style: 'cancel' },
            { text: 'Обновить', onPress: () => applyUpdate() },
          ],
        );
      }
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось проверить обновления');
    }
  };

  const row = (label, right) => (
    <View style={[s.row, { borderColor: colors.border }]}>
      <Text style={[s.label, { color: colors.text }]}>{label}</Text>
      {right}
    </View>
  );

  return (
    <ScrollView style={[s.container, { backgroundColor: colors.bg }]}>
      <Text style={[s.section, { color: colors.textSecondary }]}>Внешний вид</Text>
      {row('Тёмная тема', <Switch value={isDark} onValueChange={toggleTheme} />)}

      {bioAvailable && (
        <>
          <Text style={[s.section, { color: colors.textSecondary }]}>Безопасность</Text>
          {row('Вход по отпечатку', <Switch value={biometricEnabled} onValueChange={toggleBiometric} />)}
        </>
      )}

      <Text style={[s.section, { color: colors.textSecondary }]}>Данные</Text>
      {row(
        pending > 0 ? `Ожидает отправки: ${pending}` : 'Синхронизация',
        <TouchableOpacity onPress={handleSync} disabled={syncing}>
          <Text style={{ color: colors.primary }}>
            {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </Text>
        </TouchableOpacity>,
      )}

      <Text style={[s.section, { color: colors.textSecondary }]}>Обновления</Text>
      {row('Проверить обновления', (
        <TouchableOpacity onPress={handleCheckUpdate}>
          <Text style={{ color: colors.primary }}>Проверить</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.danger }]} onPress={logout}>
        <Text style={{ color: colors.danger, fontWeight: '600' }}>Выйти</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  label: { fontSize: 15 },
  logoutBtn: { margin: 16, padding: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
