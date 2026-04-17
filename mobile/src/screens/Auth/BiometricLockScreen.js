import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';

export default function BiometricLockScreen() {
  const { colors } = useTheme();
  const { unlockWithBiometric, cancelBiometric } = useAuth();

  useEffect(() => {
    unlockWithBiometric();
  }, [unlockWithBiometric]);

  const s = styles(colors);
  return (
    <View style={s.container}>
      <Text style={s.title}>Snippets Helper</Text>
      <Text style={s.subtitle}>Подтвердите вход</Text>

      <TouchableOpacity style={s.button} onPress={unlockWithBiometric}>
        <Text style={s.buttonText}>Отпечаток</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.linkButton} onPress={cancelBiometric}>
        <Text style={s.linkText}>Ввести API-ключ</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (c) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.bg },
  title: { fontSize: 28, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: c.textSecondary, textAlign: 'center', marginBottom: 32 },
  button: { backgroundColor: c.primary, borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', padding: 8 },
  linkText: { color: c.primary, fontSize: 14 },
});
