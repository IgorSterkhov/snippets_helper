import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { initApi, getMe } from '../../api/endpoints';

export default function QRScannerScreen({ navigation }) {
  const { colors } = useTheme();
  const { login } = useAuth();
  const [hasPermission, setHasPermission] = useState(false);
  const processing = useRef(false);
  const device = useCameraDevice('back');

  useEffect(() => {
    Camera.requestCameraPermission().then((status) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: async (codes) => {
      if (processing.current || !codes.length) return;
      processing.current = true;

      const raw = codes[0].value;
      let apiUrl = '';
      let apiKey = '';

      // Try JSON format: {"url":"...","key":"..."}
      try {
        const parsed = JSON.parse(raw);
        if (parsed.url && parsed.key) {
          apiUrl = parsed.url;
          apiKey = parsed.key;
        }
      } catch {
        // Not JSON — treat as plain API key (legacy)
        apiKey = raw;
      }

      if (!apiKey) {
        Alert.alert('Ошибка', 'QR-код не содержит API-ключ', [
          { text: 'OK', onPress: () => { processing.current = false; } },
        ]);
        return;
      }

      if (!apiUrl) {
        // No URL in QR — check saved URL
        apiUrl = await AsyncStorage.getItem('api_base_url') || '';
      }

      if (!apiUrl) {
        Alert.alert('Ошибка', 'API URL не настроен. Введите URL на экране логина.', [
          { text: 'OK', onPress: () => { processing.current = false; navigation.goBack(); } },
        ]);
        return;
      }

      try {
        initApi(apiUrl, apiKey);
        await getMe();
        await AsyncStorage.setItem('api_base_url', apiUrl);
        await login(apiKey);
      } catch (e) {
        Alert.alert('Ошибка', 'Неверный QR-код или сервер недоступен', [
          { text: 'OK', onPress: () => { processing.current = false; } },
        ]);
      }
    },
  });

  if (!hasPermission) {
    return (
      <View style={[s.container, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.text }}>Нет доступа к камере</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[s.container, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.text }}>Камера не найдена</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive={!processing.current} codeScanner={codeScanner} />
      <View style={s.overlay}>
        <View style={s.scanArea} />
      </View>
      <Text style={s.hint}>Наведите камеру на QR-код</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanArea: { width: 250, height: 250, borderWidth: 2, borderColor: '#fff', borderRadius: 12 },
  hint: { position: 'absolute', bottom: 80, color: '#fff', fontSize: 16 },
});
