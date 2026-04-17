import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authenticate, isBiometricAvailable } from './biometrics';

const AuthContext = createContext();

const API_KEY_STORAGE = 'api_key';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';

export function AuthProvider({ children }) {
  const [apiKey, setApiKey] = useState(null);
  const [storedKey, setStoredKey] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [lockedBehindBiometric, setLockedBehindBiometric] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const key = await EncryptedStorage.getItem(API_KEY_STORAGE);
        const bioEnabled = (await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)) === 'true';
        setBiometricEnabled(bioEnabled);

        if (!key) {
          setLoaded(true);
          return;
        }

        setStoredKey(key);

        if (bioEnabled && (await isBiometricAvailable())) {
          setLockedBehindBiometric(true);
          setLoaded(true);
          return;
        }

        setApiKey(key);
      } catch (e) {
        console.warn('Failed to load auth state:', e);
      }
      setLoaded(true);
    })();
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    try {
      const ok = await authenticate('Вход по отпечатку');
      if (ok && storedKey) {
        setApiKey(storedKey);
        setLockedBehindBiometric(false);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, [storedKey]);

  const cancelBiometric = useCallback(async () => {
    await EncryptedStorage.removeItem(API_KEY_STORAGE);
    setStoredKey(null);
    setLockedBehindBiometric(false);
  }, []);

  const login = async (key) => {
    await EncryptedStorage.setItem(API_KEY_STORAGE, key);
    setStoredKey(key);
    setApiKey(key);
    setLockedBehindBiometric(false);
  };

  const logout = async () => {
    await EncryptedStorage.removeItem(API_KEY_STORAGE);
    setStoredKey(null);
    setApiKey(null);
    setLockedBehindBiometric(false);
  };

  const toggleBiometric = async (enabled) => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
    setBiometricEnabled(enabled);
  };

  if (!loaded) return null;

  return (
    <AuthContext.Provider
      value={{
        apiKey,
        isAuthenticated: !!apiKey,
        lockedBehindBiometric,
        unlockWithBiometric,
        cancelBiometric,
        login,
        logout,
        biometricEnabled,
        toggleBiometric,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
