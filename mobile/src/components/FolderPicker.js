import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import FolderTree from './FolderTree';

export default function FolderPicker({ folders, selectedId, onSelect }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const selected = selectedId ? folders.find((f) => f.uuid === selectedId) : null;
  const label = selected ? selected.name : 'Все папки';

  const handleSelect = (uuid) => {
    onSelect(uuid);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[s.trigger, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[s.folderIcon, { color: colors.textMuted }]}>📁</Text>
        <Text style={[s.label, { color: colors.text }]} numberOfLines={1}>{label}</Text>
        <Text style={[s.arrow, { color: colors.textMuted }]}>▼</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[s.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[s.sheetTitle, { color: colors.text }]}>Папка</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={[s.close, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={s.scroll}>
              <TouchableOpacity
                style={[
                  s.allRow,
                  { backgroundColor: !selectedId ? colors.primaryLight : 'transparent' },
                ]}
                onPress={() => handleSelect(null)}
              >
                <Text style={[s.allText, { color: colors.text }]}>Все папки</Text>
              </TouchableOpacity>
              <FolderTree folders={folders} selectedId={selectedId} onSelect={handleSelect} />
              <View style={{ height: 24 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  folderIcon: { fontSize: 14 },
  label: { flex: 1, fontSize: 14, fontWeight: '500' },
  arrow: { fontSize: 11 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    paddingBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 16, fontWeight: '600' },
  close: { fontSize: 18, padding: 4 },
  scroll: { flexGrow: 0 },
  allRow: { paddingHorizontal: 12, paddingVertical: 12 },
  allText: { fontSize: 14, fontWeight: '500' },
});
