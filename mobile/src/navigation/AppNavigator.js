import React from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';

import LoginScreen from '../screens/Auth/LoginScreen';
import QRScannerScreen from '../screens/Auth/QRScannerScreen';
import BiometricLockScreen from '../screens/Auth/BiometricLockScreen';
import SnippetListScreen from '../screens/Snippets/SnippetListScreen';
import SnippetDetailScreen from '../screens/Snippets/SnippetDetailScreen';
import NoteListScreen from '../screens/Notes/NoteListScreen';
import NoteEditorScreen from '../screens/Notes/NoteEditorScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import UpdateBanner from '../components/UpdateBanner';

const Tab = createBottomTabNavigator();
const AuthStack = createNativeStackNavigator();
const SnippetsStack = createNativeStackNavigator();
const NotesStack = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="QRScanner" component={QRScannerScreen} />
    </AuthStack.Navigator>
  );
}

function SnippetsNavigator() {
  const { colors } = useTheme();
  return (
    <SnippetsStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bgSecondary }, headerTintColor: colors.text }}>
      <SnippetsStack.Screen name="SnippetList" component={SnippetListScreen} options={{ headerShown: false }} />
      <SnippetsStack.Screen name="SnippetDetail" component={SnippetDetailScreen} options={{ title: 'Сниппет' }} />
    </SnippetsStack.Navigator>
  );
}

function NotesNavigator() {
  const { colors } = useTheme();
  return (
    <NotesStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bgSecondary }, headerTintColor: colors.text }}>
      <NotesStack.Screen name="NoteList" component={NoteListScreen} options={{ headerShown: false }} />
      <NotesStack.Screen name="NoteEditor" component={NoteEditorScreen} options={{ title: 'Заметка' }} />
    </NotesStack.Navigator>
  );
}

function MainTabs() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <UpdateBanner />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: colors.bgSecondary, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
        }}
      >
        <Tab.Screen name="Snippets" component={SnippetsNavigator} />
        <Tab.Screen name="Notes" component={NotesNavigator} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </View>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, lockedBehindBiometric } = useAuth();
  return (
    <NavigationContainer>
      {lockedBehindBiometric ? (
        <BiometricLockScreen />
      ) : isAuthenticated ? (
        <MainTabs />
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
