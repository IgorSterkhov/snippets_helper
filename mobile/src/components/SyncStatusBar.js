import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useSyncStatus } from '../sync/useSyncStatus';
import { performSync } from '../sync/syncService';

export default function SyncStatusBar() {
  const { colors } = useTheme();
  const { pending, syncing, lastDebug, history } = useSyncStatus();
  const { width } = useWindowDimensions();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const onPress = () => {
    setDetailsOpen(true);
  };
  const status = syncing ? 'syncing' : lastDebug?.status || 'ok';
  const pillText = syncing
    ? 'Syncing...'
    : pending
      ? `Sync · ${pending} pending`
      : status === 'error'
        ? 'Sync · error'
        : status === 'warning'
          ? 'Sync · warning'
          : 'Sync · ok';
  const accent = status === 'error'
    ? colors.danger
    : status === 'warning'
      ? colors.danger
      : colors.primary;

  return (
    <>
      <TouchableOpacity
        style={[s.container, width >= 700 && s.containerWide, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {syncing ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Text style={[s.badge, { color: accent }]}>{pillText}</Text>
        {width >= 700 && lastDebug?.last_sync_at ? (
          <Text style={[s.text, { color: colors.textMuted }]} numberOfLines={1}>
            cursor {lastDebug.last_sync_at}
          </Text>
        ) : null}
      </TouchableOpacity>
      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <View style={s.modalRoot}>
          <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setDetailsOpen(false)} />
          <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.sheetHeader}>
              <View>
                <Text style={[s.sheetTitle, { color: colors.text }]}>Sync details</Text>
                <Text style={[s.sheetSub, { color: colors.textMuted }]}>
                  {pending} pending · {status}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDetailsOpen(false)}>
                <Text style={[s.closeText, { color: colors.textMuted }]}>×</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[s.syncNowBtn, { backgroundColor: colors.primary }]}
              onPress={() => performSync().catch(() => {})}
              disabled={syncing}
            >
              <Text style={s.syncNowText}>{syncing ? 'Syncing...' : 'Sync now'}</Text>
            </TouchableOpacity>
            <ScrollView style={s.detailsScroll} contentContainerStyle={s.detailsContent}>
              <View style={[s.debugCard, { borderColor: colors.border, backgroundColor: colors.bgSecondary }]}>
                <Text style={[s.debugTitle, { color: colors.textSecondary }]}>Last status</Text>
                <Text style={[s.debugText, { color: colors.text }]} selectable>
                  {lastDebug ? JSON.stringify(lastDebug, null, 2) : 'No sync has been recorded yet.'}
                </Text>
              </View>
              <Text style={[s.historyTitle, { color: colors.textSecondary }]}>Recent rows</Text>
              {history?.length ? history.map((event) => (
                <View key={event.id} style={[s.historyRow, { borderColor: colors.border }]}>
                  <View style={s.historyTop}>
                    <Text style={[s.historyStatus, { color: event.status === 'error' ? colors.danger : colors.primary }]}>{event.status}</Text>
                    <Text style={[s.historyMeta, { color: colors.textMuted }]} numberOfLines={1}>
                      {event.direction} · {event.action || 'row'}
                    </Text>
                  </View>
                  <Text style={[s.historyTable, { color: colors.text }]} numberOfLines={1}>
                    {[event.table_name, event.row_uuid].filter(Boolean).join(' / ') || 'summary'}
                  </Text>
                  {event.details_json ? (
                    <Text style={[s.historyDetails, { color: colors.textMuted }]} selectable numberOfLines={3}>
                      {event.details_json}
                    </Text>
                  ) : null}
                </View>
              )) : (
                <Text style={[s.emptyText, { color: colors.textMuted }]}>No sync history yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
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
  containerWide: { alignSelf: 'flex-start', minWidth: 260 },
  badge: { fontSize: 13, fontWeight: '600' },
  text: { fontSize: 12 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSub: { marginTop: 2, fontSize: 12 },
  closeText: { fontSize: 24, lineHeight: 26 },
  syncNowBtn: { alignItems: 'center', borderRadius: 8, paddingVertical: 10 },
  syncNowText: { color: '#fff', fontWeight: '700' },
  detailsScroll: { maxHeight: 520 },
  detailsContent: { gap: 10, paddingBottom: 12 },
  debugCard: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  debugTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  debugText: { fontSize: 11, fontFamily: 'monospace' },
  historyTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  historyRow: { borderWidth: 1, borderRadius: 8, padding: 9, gap: 4 },
  historyTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  historyStatus: { fontSize: 12, fontWeight: '700' },
  historyMeta: { flex: 1, textAlign: 'right', fontSize: 11 },
  historyTable: { fontSize: 12, fontWeight: '600' },
  historyDetails: { fontSize: 11, fontFamily: 'monospace' },
  emptyText: { fontSize: 12 },
});
