import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView, StyleSheet, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { isBiometricAvailable } from '../../auth/biometrics';
import { performFullPullFromServer, performSync } from '../../sync/syncService';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { getLastSyncDebug } from '../../db/syncMetaRepo';
import { openApkDownload } from '../../updater/apkDownload';
import { loadApkVersionStatus } from '../../updater/updateService';
import { TASK_PREF_KEYS, loadTaskPreferences, setTaskPreference } from '../Tasks/taskPreferences';

export default function SettingsScreen() {
  const { colors, isDark, toggle: toggleTheme } = useTheme();
  const { logout, biometricEnabled, toggleBiometric } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [taskPrefs, setTaskPrefs] = useState({ hideDone: false, wrapText: true });
  const [apkStatus, setApkStatus] = useState(null);
  const [apkStatusLoading, setApkStatusLoading] = useState(true);
  const [syncDebug, setSyncDebug] = useState(null);
  const { pending, syncing } = useSyncStatus();

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
    loadTaskPreferences().then(setTaskPrefs).catch(() => {});
    refreshApkStatus();
    refreshSyncDebug();
  }, []);

  const refreshSyncDebug = async () => {
    setSyncDebug(await getLastSyncDebug().catch(() => null));
  };

  const refreshApkStatus = async () => {
    setApkStatusLoading(true);
    try {
      setApkStatus(await loadApkVersionStatus());
    } finally {
      setApkStatusLoading(false);
    }
  };

  const updateTaskPreference = async (key, value) => {
    await setTaskPreference(key, value);
    setTaskPrefs((prev) => ({
      ...prev,
      hideDone: key === TASK_PREF_KEYS.hideDone ? value : prev.hideDone,
      wrapText: key === TASK_PREF_KEYS.wrapText ? value : prev.wrapText,
    }));
  };

  const handleSync = async () => {
    try {
      await performSync();
      await refreshSyncDebug();
      Alert.alert('Синхронизация', 'Данные синхронизированы');
    } catch (e) {
      const debug = await getLastSyncDebug().catch(() => null);
      setSyncDebug(debug);
      showSyncError(String(e?.message || e), debug);
    }
  };

  const runForceFullPull = async () => {
    try {
      await performFullPullFromServer();
      await refreshSyncDebug();
      Alert.alert('Full pull', 'Данные заново загружены с сервера');
    } catch (e) {
      const debug = await getLastSyncDebug().catch(() => null);
      setSyncDebug(debug);
      showSyncError(String(e?.message || e), debug);
    }
  };

  const handleForceFullPull = () => {
    Alert.alert(
      'Full pull from server',
      'Приложение заново загрузит все строки с сервера без отправки локальных изменений. Если есть ожидающие отправки изменения, сначала выполните обычную синхронизацию.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Запустить', onPress: runForceFullPull },
      ],
    );
  };

  const formatCounts = (counts = {}) => Object.entries(counts)
    .map(([table, count]) => `${table}: ${count}`)
    .join(', ');

  const syncDebugText = (debug = syncDebug) => {
    if (!debug) return 'Диагностика синхронизации пока отсутствует';
    const lines = [
      `status: ${debug.status || 'unknown'}`,
      debug.timestamp ? `time: ${debug.timestamp}` : '',
      debug.last_sync_at ? `last_sync_at: ${debug.last_sync_at}` : '',
      debug.pulled_counts ? `pulled: ${formatCounts(debug.pulled_counts) || '0'}` : '',
      debug.pushed_counts ? `pushed: ${formatCounts(debug.pushed_counts) || '0'}` : '',
      debug.rejected_uuids && Object.keys(debug.rejected_uuids).length
        ? `rejected: ${JSON.stringify(debug.rejected_uuids)}`
        : '',
      debug.conflicts && debug.conflicts.length ? `conflicts: ${JSON.stringify(debug.conflicts)}` : '',
      debug.error ? `error: ${debug.error}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  };

  const syncDebugLabel = () => {
    if (!syncDebug) return 'Последняя синхронизация: нет данных';
    const status = syncDebug.status || 'unknown';
    const pulled = Object.values(syncDebug.pulled_counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const pushed = Object.values(syncDebug.pushed_counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    return `Последняя синхронизация: ${status} · pulled ${pulled} · pushed ${pushed}`;
  };

  const showSyncDebug = () => {
    const text = syncDebugText();
    Alert.alert('Sync diagnostics', text, [
      { text: 'Copy', onPress: () => Clipboard.setString(text) },
      { text: 'OK' },
    ]);
  };

  const showSyncError = (message, debug) => {
    const text = `${message}\n\n${syncDebugText(debug)}`;
    Alert.alert('Ошибка синхронизации', text, [
      { text: 'Copy', onPress: () => Clipboard.setString(text) },
      { text: 'OK' },
    ]);
  };

  const handleCheckUpdate = async () => {
    try {
      const { checkForUpdate, applyUpdate, setOnProgress } = require('../../updater/updateService');
      const update = await checkForUpdate(true);
      if (update) {
        if (update.type === 'apk') {
          Alert.alert(
            'Нужен новый APK',
            `Доступна новая APK-сборка${update.apk_version_code ? ` #${update.apk_version_code}` : ''}\n${update.release_notes || ''}`,
            [
              { text: 'Позже', style: 'cancel' },
              { text: 'Скачать APK', onPress: () => openApkDownload(undefined, update.apk_url) },
            ],
          );
          return;
        }
        Alert.alert(
          'Обновление доступно',
          `Версия ${update.version}\n${update.release_notes || ''}`,
          [
            { text: 'Позже', style: 'cancel' },
            { text: 'Обновить', onPress: () => applyUpdate() },
          ],
        );
      }
      await refreshApkStatus();
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось проверить обновления');
    }
  };

  const handleDownloadApk = async () => {
    try {
      await openApkDownload(undefined, apkStatus?.apkUrl);
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось открыть ссылку на APK');
    }
  };

  const renderApkStatus = () => {
    const current = apkStatus?.currentVersionCode || 0;
    const latest = apkStatus?.latestVersionCode || 0;
    const currentLabel = current ? `#${current}` : 'старый APK';
    const latestLabel = latest ? `#${latest}` : 'сервер неизвестен';
    const hasError = Boolean(apkStatus?.error);
    const label = hasError
      ? `APK AI/микрофон: статус неизвестен\n${apkStatus.error}`
      : latest
      ? `APK AI/микрофон: установлено ${currentLabel}, доступно ${latestLabel}`
      : `APK AI/микрофон: ${currentLabel}, ${latestLabel}`;

    return row(label, apkStatusLoading ? (
      <Text style={{ color: colors.textMuted }}>Проверяю…</Text>
    ) : hasError || !latest ? (
      <TouchableOpacity onPress={refreshApkStatus}>
        <Text style={{ color: colors.primary }}>Проверить</Text>
      </TouchableOpacity>
    ) : apkStatus?.needsUpdate ? (
      <TouchableOpacity onPress={handleDownloadApk}>
        <Text style={{ color: colors.primary }}>Скачать APK</Text>
      </TouchableOpacity>
    ) : (
      <Text style={{ color: colors.success || colors.primary }}>Актуален</Text>
    ));
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

      <Text style={[s.section, { color: colors.textSecondary }]}>Задачи</Text>
      {row('Скрывать выполненные чекбоксы', (
        <Switch
          value={taskPrefs.hideDone}
          onValueChange={(value) => updateTaskPreference(TASK_PREF_KEYS.hideDone, value)}
        />
      ))}
      {row('Переносить текст чекбоксов', (
        <Switch
          value={taskPrefs.wrapText}
          onValueChange={(value) => updateTaskPreference(TASK_PREF_KEYS.wrapText, value)}
        />
      ))}

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
      {row('Принудительно загрузить все с сервера', (
        <TouchableOpacity onPress={handleForceFullPull} disabled={syncing}>
          <Text style={{ color: colors.primary }}>
            {syncing ? 'Синхронизация…' : 'Full pull'}
          </Text>
        </TouchableOpacity>
      ))}
      {row(syncDebugLabel(), (
        <TouchableOpacity onPress={showSyncDebug}>
          <Text style={{ color: colors.primary }}>Детали</Text>
        </TouchableOpacity>
      ))}

      <Text style={[s.section, { color: colors.textSecondary }]}>Обновления</Text>
      {row('Проверить обновления', (
        <TouchableOpacity onPress={handleCheckUpdate}>
          <Text style={{ color: colors.primary }}>Проверить</Text>
        </TouchableOpacity>
      ))}
      {renderApkStatus()}

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
  label: { flex: 1, marginRight: 12, fontSize: 15 },
  logoutBtn: { margin: 16, padding: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
