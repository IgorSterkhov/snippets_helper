import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { initDB } from './src/db/database';
import { initApi } from './src/api/endpoints';
import { performSync } from './src/sync/syncService';
import { startNetworkListener } from './src/sync/networkListener';
import { initFCM, setupFCMListeners } from './src/notifications/fcm';

function StatusBarWrapper() {
  const { colors } = useTheme();
  return <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />;
}

function AppContent() {
  const { apiKey } = useAuth();

  useEffect(() => {
    if (!apiKey) return;
    (async () => {
      await initDB();
      initApi('http://REDACTED:8000', apiKey);
      performSync().catch(console.warn);
      startNetworkListener();
    })();
  }, [apiKey]);

  useEffect(() => {
    initFCM();
    setupFCMListeners();
  }, []);

  return (
    <>
      <StatusBarWrapper />
      <AppNavigator />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
