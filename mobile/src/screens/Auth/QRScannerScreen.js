import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { initApi, getMe } from '../../api/endpoints';

const API_BASE_URL = 'http://REDACTED:8000';

export default function QRScannerScreen({ navigation }) {
  const { colors } = useTheme();
  const { login } = useAuth();
  const [hasPermission, setHasPermission] = useState(false);
  const [scanned, setScanned] = useState(false);
  const device = useCameraDevice('back');

  useEffect(() => {
    Camera.requestCameraPermission().then((status) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: async (codes) => {
      if (scanned || !codes.length) return;
      setScanned(true);
      const apiKey = codes[0].value;
      try {
        initApi(API_BASE_URL, apiKey);
        await getMe();
        await login(apiKey);
      } catch (e) {
        Alert.alert('Ошибка', 'Неверный QR-код');
        setScanned(false);
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
      <Camera style={StyleSheet.absoluteFill} device={device} isActive={!scanned} codeScanner={codeScanner} />
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
