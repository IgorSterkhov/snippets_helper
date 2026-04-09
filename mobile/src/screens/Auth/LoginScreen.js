import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { initApi, getMe } from '../../api/endpoints';
import { API_BASE_URL } from '../../config';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const { login } = useAuth();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!key.trim()) return;
    setLoading(true);
    try {
      initApi(API_BASE_URL, key.trim());
      await getMe();
      await login(key.trim());
    } catch (e) {
      Alert.alert('Ошибка', 'Неверный API-ключ или сервер недоступен');
    } finally {
      setLoading(false);
    }
  };

  const s = styles(colors);
  return (
    <View style={s.container}>
      <Text style={s.title}>Snippets Helper</Text>
      <Text style={s.subtitle}>Введите API-ключ</Text>

      <TextInput
        style={s.input}
        value={key}
        onChangeText={setKey}
        placeholder="API-ключ"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity style={s.button} onPress={handleLogin} disabled={loading}>
        <Text style={s.buttonText}>{loading ? 'Проверка...' : 'Войти'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.linkButton} onPress={() => navigation.navigate('QRScanner')}>
        <Text style={s.linkText}>Сканировать QR-код</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (c) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.bg },
  title: { fontSize: 28, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: c.textSecondary, textAlign: 'center', marginBottom: 32 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 14, fontSize: 16, color: c.text, backgroundColor: c.bgSecondary, marginBottom: 16 },
  button: { backgroundColor: c.primary, borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { alignItems: 'center', padding: 8 },
  linkText: { color: c.primary, fontSize: 14 },
});
