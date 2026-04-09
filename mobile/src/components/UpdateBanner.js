import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { checkForUpdate, applyUpdate, setOnProgress } from '../updater/updateService';

export default function UpdateBanner() {
  const { colors } = useTheme();
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    checkForUpdate().then(setUpdate);
  }, []);

  if (!update) return null;

  const handleUpdate = async () => {
    setDownloading(true);
    setOnProgress((p) => setProgress(p));
    await applyUpdate();
  };

  return (
    <View style={[s.container, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
      <Text style={[s.text, { color: colors.text }]}>
        Доступна версия {update.version}
      </Text>
      {downloading ? (
        <View style={s.progressWrap}>
          <View style={[s.progressBar, { backgroundColor: colors.primary, width: `${(progress || 0) * 100}%` }]} />
        </View>
      ) : (
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={handleUpdate}>
          <Text style={s.btnText}>Обновить</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { margin: 12, padding: 12, borderRadius: 8, borderWidth: 1 },
  text: { fontSize: 14, marginBottom: 8 },
  btn: { padding: 10, borderRadius: 6, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
  progressWrap: { height: 6, backgroundColor: '#ddd', borderRadius: 3, overflow: 'hidden' },
  progressBar: { height: '100%', borderRadius: 3 },
});
