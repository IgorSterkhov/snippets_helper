import React, { createContext, useContext, useState, useEffect } from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext();

const API_KEY_STORAGE = 'api_key';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';

export function AuthProvider({ children }) {
  const [apiKey, setApiKey] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const key = await EncryptedStorage.getItem(API_KEY_STORAGE);
        const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
        if (bioEnabled === 'true') setBiometricEnabled(true);
        if (key) setApiKey(key);
      } catch (e) {
        console.warn('Failed to load auth state:', e);
      }
      setLoaded(true);
    })();
  }, []);

  const login = async (key) => {
    await EncryptedStorage.setItem(API_KEY_STORAGE, key);
    setApiKey(key);
  };

  const logout = async () => {
    await EncryptedStorage.removeItem(API_KEY_STORAGE);
    setApiKey(null);
  };

  const toggleBiometric = async (enabled) => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
    setBiometricEnabled(enabled);
  };

  if (!loaded) return null;

  return (
    <AuthContext.Provider value={{ apiKey, isAuthenticated: !!apiKey, login, logout, biometricEnabled, toggleBiometric }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
