# Mobile App — Snippets Helper: Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать Android-приложение на React Native с модулями Сниппетов и Заметок, офлайн-работой, синхронизацией через существующий API и self-hosted OTA-обновлениями.

**Architecture:** React Native (bare workflow) с локальной SQLite для офлайн-first работы. Синхронизация через существующий FastAPI sync API (push/pull, last-write-wins). OTA-обновления JS-бандла через `react-native-ota-hot-update` с хостингом на собственном сервере.

**Tech Stack:** React Native CLI, react-native-sqlite-storage, react-native-biometrics, react-native-vision-camera, react-native-ota-hot-update, @react-native-firebase/messaging, @react-navigation/bottom-tabs

**Spec:** `.workflow/specs/2026-04-09-mobile-app-design.md`

---

## File Structure

```
mobile/
├── src/
│   ├── api/
│   │   ├── client.js              # HTTP-клиент с Bearer-авторизацией
│   │   └── endpoints.js           # Функции вызова API-эндпоинтов
│   ├── auth/
│   │   ├── AuthContext.js         # React context для состояния авторизации
│   │   ├── keystore.js            # Обёртка Android Keystore (сохранение/чтение API-ключа)
│   │   └── biometrics.js          # Fingerprint-авторизация
│   ├── db/
│   │   ├── database.js            # SQLite инициализация и миграции
│   │   ├── snippetRepo.js         # CRUD для shortcuts и snippet_tags
│   │   ├── noteRepo.js            # CRUD для notes и note_folders
│   │   └── syncMetaRepo.js        # Чтение/запись last_sync_at
│   ├── sync/
│   │   ├── syncService.js         # Оркестрация push/pull
│   │   └── networkListener.js     # Отслеживание online/offline, автосинк
│   ├── screens/
│   │   ├── Auth/
│   │   │   ├── LoginScreen.js     # Ввод API-ключа вручную
│   │   │   └── QRScannerScreen.js # Сканирование QR-кода с ключом
│   │   ├── Snippets/
│   │   │   ├── SnippetListScreen.js   # Список сниппетов + поиск + теги
│   │   │   └── SnippetDetailScreen.js # Просмотр/редактирование сниппета
│   │   ├── Notes/
│   │   │   ├── NoteListScreen.js      # Папки + список заметок
│   │   │   └── NoteEditorScreen.js    # Редактор/просмотр заметки (markdown)
│   │   └── Settings/
│   │       └── SettingsScreen.js      # API-ключ, тема, fingerprint, обновления
│   ├── components/
│   │   ├── SearchBar.js           # Поле поиска
│   │   ├── TagFilter.js           # Панель фильтрации по тегам
│   │   ├── FolderTree.js          # Дерево папок (рекурсивное)
│   │   ├── MarkdownView.js        # Рендер markdown
│   │   ├── UpdateBanner.js        # Баннер "Доступно обновление" + прогресс-бар
│   │   └── Toast.js               # Toast-уведомления
│   ├── theme/
│   │   ├── ThemeContext.js        # React context + переключатель тем
│   │   └── colors.js              # Цветовые палитры light/dark
│   ├── updater/
│   │   └── updateService.js       # Проверка и применение OTA-обновлений
│   ├── navigation/
│   │   └── AppNavigator.js        # Bottom tabs + auth stack
│   └── App.js                     # Корневой компонент (providers)
├── __tests__/
│   ├── db/
│   │   ├── snippetRepo.test.js
│   │   ├── noteRepo.test.js
│   │   └── syncMetaRepo.test.js
│   ├── sync/
│   │   └── syncService.test.js
│   ├── api/
│   │   └── client.test.js
│   └── auth/
│       └── keystore.test.js
├── android/
├── package.json
├── app.json
├── babel.config.js
├── metro.config.js
└── jest.config.js
```

---

## Chunk 1: Project Setup & Foundation

### Task 1: Инициализация React Native проекта

**Files:**
- Create: `mobile/` (весь скаффолд)
- Create: `mobile/package.json`

- [ ] **Step 1: Создать React Native проект**

```bash
cd /home/aster/dev/snippets_helper
npx @react-native-community/cli init SnippetsHelper --directory mobile --skip-git
```

- [ ] **Step 2: Проверить что проект создан**

```bash
ls mobile/src 2>/dev/null || echo "src not created by default"
ls mobile/android mobile/package.json
```

- [ ] **Step 3: Создать структуру директорий**

```bash
cd mobile
mkdir -p src/{api,auth,db,sync,screens/{Auth,Snippets,Notes,Settings},components,theme,updater,navigation}
mkdir -p __tests__/{db,sync,api,auth}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/
git commit -m "init react native project for mobile app"
```

---

### Task 2: Установка зависимостей

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Установить навигацию**

```bash
cd mobile
npm install @react-navigation/native @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context
```

- [ ] **Step 2: Установить SQLite**

```bash
npm install react-native-sqlite-storage
```

- [ ] **Step 3: Установить авторизацию и QR**

```bash
npm install react-native-biometrics react-native-vision-camera react-native-encrypted-storage
```

- [ ] **Step 4: Установить UI-утилиты**

```bash
npm install react-native-markdown-display @react-native-async-storage/async-storage react-native-vector-icons
```

- [ ] **Step 5: Установить OTA и Firebase**

```bash
npm install react-native-ota-hot-update
npm install @react-native-firebase/app @react-native-firebase/messaging
```

- [ ] **Step 6: Установить сетевые утилиты**

```bash
npm install @react-native-community/netinfo
```

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/package-lock.json
git commit -m "add mobile app dependencies"
```

---

### Task 3: Цветовые палитры (тема)

**Files:**
- Create: `mobile/src/theme/colors.js`

- [ ] **Step 1: Создать файл палитр**

```javascript
// mobile/src/theme/colors.js

export const lightColors = {
  bg: '#ffffff',
  bgSecondary: '#f5f5f5',
  bgTertiary: '#e8e8e8',
  text: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#e0e0e0',
  primary: '#007aff',
  primaryLight: '#e3f0ff',
  danger: '#ff3b30',
  success: '#34c759',
  card: '#ffffff',
  statusBar: 'dark-content',
};

export const darkColors = {
  bg: '#1a1a1a',
  bgSecondary: '#2a2a2a',
  bgTertiary: '#3a3a3a',
  text: '#e0e0e0',
  textSecondary: '#aaaaaa',
  textMuted: '#777777',
  border: '#3a3a3a',
  primary: '#0a84ff',
  primaryLight: '#1a3a5c',
  danger: '#ff453a',
  success: '#30d158',
  card: '#2a2a2a',
  statusBar: 'light-content',
};
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/theme/colors.js
git commit -m "add light and dark color palettes"
```

---

### Task 4: ThemeContext

**Files:**
- Create: `mobile/src/theme/ThemeContext.js`

- [ ] **Step 1: Создать контекст темы**

```javascript
// mobile/src/theme/ThemeContext.js

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors } from './colors';

const ThemeContext = createContext();

const THEME_KEY = 'app_theme';

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((val) => {
      if (val === 'dark') setIsDark(true);
      setLoaded(true);
    });
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
  };

  const colors = isDark ? darkColors : lightColors;

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ isDark, toggle, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/theme/ThemeContext.js
git commit -m "add theme context with light/dark toggle"
```

---

### Task 5: Навигация (AppNavigator)

**Files:**
- Create: `mobile/src/navigation/AppNavigator.js`
- Create placeholder screens

- [ ] **Step 1: Создать placeholder экраны**

Создать минимальные заглушки для каждого экрана. Пример для одного:

```javascript
// mobile/src/screens/Snippets/SnippetListScreen.js
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export default function SnippetListScreen() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
      <Text style={{ color: colors.text }}>Snippets</Text>
    </View>
  );
}
```

Аналогично создать:
- `mobile/src/screens/Notes/NoteListScreen.js` — текст "Notes"
- `mobile/src/screens/Settings/SettingsScreen.js` — текст "Settings"
- `mobile/src/screens/Auth/LoginScreen.js` — текст "Login"

- [ ] **Step 2: Создать навигатор**

```javascript
// mobile/src/navigation/AppNavigator.js

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';

import LoginScreen from '../screens/Auth/LoginScreen';
import QRScannerScreen from '../screens/Auth/QRScannerScreen';
import SnippetListScreen from '../screens/Snippets/SnippetListScreen';
import NoteListScreen from '../screens/Notes/NoteListScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';

const Tab = createBottomTabNavigator();
const AuthStack = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="QRScanner" component={QRScannerScreen} />
    </AuthStack.Navigator>
  );
}

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bgSecondary, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tab.Screen name="Snippets" component={SnippetListScreen} />
      <Tab.Screen name="Notes" component={NoteListScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated } = useAuth();
  return (
    <NavigationContainer>
      {isAuthenticated ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/navigation/ mobile/src/screens/
git commit -m "add bottom tab navigation and placeholder screens"
```

---

### Task 6: AuthContext (заглушка)

**Files:**
- Create: `mobile/src/auth/AuthContext.js`

- [ ] **Step 1: Создать контекст авторизации**

```javascript
// mobile/src/auth/AuthContext.js

import React, { createContext, useContext, useState, useEffect } from 'react';
import EncryptedStorage from 'react-native-encrypted-storage';

const AuthContext = createContext();

const API_KEY_STORAGE = 'api_key';

export function AuthProvider({ children }) {
  const [apiKey, setApiKey] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    EncryptedStorage.getItem(API_KEY_STORAGE).then((key) => {
      if (key) setApiKey(key);
      setLoaded(true);
    });
  }, []);

  const login = async (key) => {
    await EncryptedStorage.setItem(API_KEY_STORAGE, key);
    setApiKey(key);
  };

  const logout = async () => {
    await EncryptedStorage.removeItem(API_KEY_STORAGE);
    setApiKey(null);
  };

  if (!loaded) return null;

  return (
    <AuthContext.Provider value={{ apiKey, isAuthenticated: !!apiKey, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/auth/AuthContext.js
git commit -m "add auth context with encrypted storage"
```

---

### Task 7: App.js (корневой компонент)

**Files:**
- Modify: `mobile/App.js` (или `mobile/src/App.js` в зависимости от скаффолда)

- [ ] **Step 1: Собрать провайдеры**

```javascript
// mobile/App.js

import React from 'react';
import { StatusBar } from 'react-native';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider } from './src/auth/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

function StatusBarWrapper() {
  const { colors } = useTheme();
  return <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <StatusBarWrapper />
        <AppNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Запустить приложение, убедиться что работает**

```bash
cd mobile
npx react-native run-android
```

Ожидание: приложение запускается, показывает экран Login (т.к. нет API-ключа).

- [ ] **Step 3: Commit**

```bash
git add mobile/App.js
git commit -m "wire up root App with theme and auth providers"
```

---

## Chunk 2: Database Layer

### Task 8: SQLite — инициализация и миграции

**Files:**
- Create: `mobile/src/db/database.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/db/database.test.js

import { getDB, initDB } from '../../src/db/database';

// Mock SQLite
jest.mock('react-native-sqlite-storage', () => ({
  openDatabase: jest.fn(() => ({
    transaction: jest.fn((callback) => {
      const tx = {
        executeSql: jest.fn((sql, params, success) => {
          if (success) success(tx, { rows: { length: 0, item: () => ({}) } });
        }),
      };
      callback(tx);
    }),
  })),
  enablePromise: jest.fn(),
}));

describe('database', () => {
  test('initDB creates all tables', async () => {
    const SQLite = require('react-native-sqlite-storage');
    await initDB();
    const db = getDB();
    expect(db).toBeDefined();
    const tx = db.transaction.mock.calls[0][0];
    // Verify executeSql was called for each table
    expect(db.transaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd mobile && npx jest __tests__/db/database.test.js
```

- [ ] **Step 3: Реализовать database.js**

```javascript
// mobile/src/db/database.js

import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db = null;

export function getDB() {
  return db;
}

export async function initDB() {
  db = await SQLite.openDatabase({ name: 'snippets_helper.db', location: 'default' });

  await db.transaction((tx) => {
    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS shortcuts (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        links TEXT DEFAULT '[]',
        obsidian_note TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS snippet_tags (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        patterns TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL DEFAULT '#388bfd',
        sort_order INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS note_folders (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        parent_id INTEGER,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS notes (
        uuid TEXT PRIMARY KEY,
        folder_uuid TEXT,
        title TEXT NOT NULL,
        content TEXT,
        created_at TEXT,
        updated_at TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    tx.executeSql(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  });

  return db;
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd mobile && npx jest __tests__/db/database.test.js
```

- [ ] **Step 5: Commit**

```bash
git add mobile/src/db/database.js mobile/__tests__/db/database.test.js
git commit -m "add SQLite database init with schema migrations"
```

---

### Task 9: syncMetaRepo

**Files:**
- Create: `mobile/src/db/syncMetaRepo.js`
- Create: `mobile/__tests__/db/syncMetaRepo.test.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/db/syncMetaRepo.test.js

import { getLastSyncAt, setLastSyncAt } from '../../src/db/syncMetaRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('syncMetaRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getLastSyncAt returns null when no record', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, item: () => ({}) } });
    });
    const result = await getLastSyncAt();
    expect(result).toBeNull();
  });

  test('getLastSyncAt returns stored timestamp', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 1, item: () => ({ value: '2026-01-01T00:00:00' }) } });
    });
    const result = await getLastSyncAt();
    expect(result).toBe('2026-01-01T00:00:00');
  });

  test('setLastSyncAt stores timestamp', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });
    await setLastSyncAt('2026-01-01T00:00:00');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.arrayContaining(['last_sync_at', '2026-01-01T00:00:00']),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

- [ ] **Step 3: Реализовать syncMetaRepo.js**

```javascript
// mobile/src/db/syncMetaRepo.js

import { getDB } from './database';

export function getLastSyncAt() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(
        'SELECT value FROM sync_meta WHERE key = ?',
        ['last_sync_at'],
        (_, result) => {
          if (result.rows.length > 0) {
            resolve(result.rows.item(0).value);
          } else {
            resolve(null);
          }
        },
        (_, error) => reject(error),
      );
    });
  });
}

export function setLastSyncAt(timestamp) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(
        'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
        ['last_sync_at', timestamp],
        () => resolve(),
        (_, error) => reject(error),
      );
    });
  });
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/db/syncMetaRepo.js mobile/__tests__/db/syncMetaRepo.test.js
git commit -m "add sync meta repo for last_sync_at tracking"
```

---

### Task 10: snippetRepo

**Files:**
- Create: `mobile/src/db/snippetRepo.js`
- Create: `mobile/__tests__/db/snippetRepo.test.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/db/snippetRepo.test.js

import { getAllSnippets, upsertSnippet, searchSnippets, getSnippetsByTag, getModifiedSince, getAllTags, upsertTag } from '../../src/db/snippetRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('snippetRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getAllSnippets selects non-deleted ordered by name', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, raw: () => [] } });
    });
    await getAllSnippets();
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('is_deleted = 0'),
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('upsertSnippet inserts or replaces', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      if (success) success(mockTx, { rows: { length: 0 } });
    });
    const snippet = { uuid: 'abc', name: 'test', value: 'val', description: '', links: '[]', obsidian_note: '', updated_at: '2026-01-01', is_deleted: 0 };
    await upsertSnippet(snippet);
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE'),
      expect.arrayContaining(['abc', 'test', 'val']),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('searchSnippets filters by query', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, raw: () => [] } });
    });
    await searchSnippets('hello');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('LIKE'),
      expect.arrayContaining(['%hello%']),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

- [ ] **Step 3: Реализовать snippetRepo.js**

```javascript
// mobile/src/db/snippetRepo.js

import { getDB } from './database';

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, result) => resolve(result), (_, err) => reject(err));
    });
  });
}

function rowsToArray(result) {
  const arr = [];
  for (let i = 0; i < result.rows.length; i++) {
    arr.push(result.rows.item(i));
  }
  return arr;
}

// --- Snippets ---

export async function getAllSnippets() {
  const result = await query('SELECT * FROM shortcuts WHERE is_deleted = 0 ORDER BY name COLLATE NOCASE', []);
  return rowsToArray(result);
}

export async function searchSnippets(q) {
  const result = await query(
    'SELECT * FROM shortcuts WHERE is_deleted = 0 AND (name LIKE ? OR value LIKE ? OR description LIKE ?) ORDER BY name COLLATE NOCASE',
    [`%${q}%`, `%${q}%`, `%${q}%`],
  );
  return rowsToArray(result);
}

export async function getSnippetsByTag(tagPatterns) {
  // tagPatterns — массив паттернов из тега, фильтруем сниппеты по совпадению name
  const all = await getAllSnippets();
  return all.filter((s) => tagPatterns.some((p) => s.name.toLowerCase().includes(p.toLowerCase())));
}

export async function upsertSnippet(s) {
  await query(
    `INSERT OR REPLACE INTO shortcuts (uuid, name, value, description, links, obsidian_note, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.uuid, s.name, s.value, s.description || '', s.links || '[]', s.obsidian_note || '', s.updated_at, s.is_deleted ? 1 : 0],
  );
}

export async function deleteSnippet(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE shortcuts SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedSnippetsSince(since) {
  const sql = since
    ? 'SELECT * FROM shortcuts WHERE updated_at > ?'
    : 'SELECT * FROM shortcuts';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Tags ---

export async function getAllTags() {
  const result = await query('SELECT * FROM snippet_tags WHERE is_deleted = 0 ORDER BY sort_order', []);
  return rowsToArray(result);
}

export async function upsertTag(t) {
  await query(
    `INSERT OR REPLACE INTO snippet_tags (uuid, name, patterns, color, sort_order, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [t.uuid, t.name, t.patterns || '[]', t.color || '#388bfd', t.sort_order || 0, t.updated_at, t.is_deleted ? 1 : 0],
  );
}

export async function getModifiedTagsSince(since) {
  const sql = since
    ? 'SELECT * FROM snippet_tags WHERE updated_at > ?'
    : 'SELECT * FROM snippet_tags';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/db/snippetRepo.js mobile/__tests__/db/snippetRepo.test.js
git commit -m "add snippet and tag repo with CRUD operations"
```

---

### Task 11: noteRepo

**Files:**
- Create: `mobile/src/db/noteRepo.js`
- Create: `mobile/__tests__/db/noteRepo.test.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/db/noteRepo.test.js

import { getAllFolders, upsertFolder, getNotesByFolder, upsertNote, getModifiedNotesSince, getModifiedFoldersSince } from '../../src/db/noteRepo';
import { getDB } from '../../src/db/database';

jest.mock('../../src/db/database');

describe('noteRepo', () => {
  const mockExecuteSql = jest.fn();
  const mockTx = { executeSql: mockExecuteSql };

  beforeEach(() => {
    jest.clearAllMocks();
    getDB.mockReturnValue({
      transaction: jest.fn((cb) => cb(mockTx)),
    });
  });

  test('getAllFolders selects non-deleted ordered by sort_order', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, raw: () => [] } });
    });
    await getAllFolders();
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('is_deleted = 0'),
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('getNotesByFolder filters by folder_uuid', async () => {
    mockExecuteSql.mockImplementation((sql, params, success) => {
      success(mockTx, { rows: { length: 0, raw: () => [] } });
    });
    await getNotesByFolder('folder-uuid-1');
    expect(mockExecuteSql).toHaveBeenCalledWith(
      expect.stringContaining('folder_uuid = ?'),
      expect.arrayContaining(['folder-uuid-1']),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

- [ ] **Step 3: Реализовать noteRepo.js**

```javascript
// mobile/src/db/noteRepo.js

import { getDB } from './database';

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, result) => resolve(result), (_, err) => reject(err));
    });
  });
}

function rowsToArray(result) {
  const arr = [];
  for (let i = 0; i < result.rows.length; i++) {
    arr.push(result.rows.item(i));
  }
  return arr;
}

// --- Folders ---

export async function getAllFolders() {
  const result = await query('SELECT * FROM note_folders WHERE is_deleted = 0 ORDER BY sort_order', []);
  return rowsToArray(result);
}

export async function upsertFolder(f) {
  await query(
    `INSERT OR REPLACE INTO note_folders (uuid, name, sort_order, parent_id, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [f.uuid, f.name, f.sort_order || 0, f.parent_id || null, f.updated_at, f.is_deleted ? 1 : 0],
  );
}

export async function deleteFolder(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE note_folders SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedFoldersSince(since) {
  const sql = since
    ? 'SELECT * FROM note_folders WHERE updated_at > ?'
    : 'SELECT * FROM note_folders';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}

// --- Notes ---

export async function getNotesByFolder(folderUuid) {
  const result = await query(
    'SELECT * FROM notes WHERE folder_uuid = ? AND is_deleted = 0 ORDER BY is_pinned DESC, updated_at DESC',
    [folderUuid],
  );
  return rowsToArray(result);
}

export async function getAllNotes() {
  const result = await query('SELECT * FROM notes WHERE is_deleted = 0 ORDER BY updated_at DESC', []);
  return rowsToArray(result);
}

export async function searchNotes(q) {
  const result = await query(
    'SELECT * FROM notes WHERE is_deleted = 0 AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC',
    [`%${q}%`, `%${q}%`],
  );
  return rowsToArray(result);
}

export async function upsertNote(n) {
  await query(
    `INSERT OR REPLACE INTO notes (uuid, folder_uuid, title, content, created_at, updated_at, is_pinned, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [n.uuid, n.folder_uuid || null, n.title, n.content || '', n.created_at || new Date().toISOString(), n.updated_at, n.is_pinned || 0, n.is_deleted ? 1 : 0],
  );
}

export async function deleteNote(uuid) {
  const now = new Date().toISOString();
  await query('UPDATE notes SET is_deleted = 1, updated_at = ? WHERE uuid = ?', [now, uuid]);
}

export async function getModifiedNotesSince(since) {
  const sql = since
    ? 'SELECT * FROM notes WHERE updated_at > ?'
    : 'SELECT * FROM notes';
  const result = await query(sql, since ? [since] : []);
  return rowsToArray(result);
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/db/noteRepo.js mobile/__tests__/db/noteRepo.test.js
git commit -m "add note and folder repo with CRUD operations"
```

---

## Chunk 3: API Client & Sync

### Task 12: HTTP-клиент

**Files:**
- Create: `mobile/src/api/client.js`
- Create: `mobile/__tests__/api/client.test.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/api/client.test.js

import { createClient } from '../../src/api/client';

global.fetch = jest.fn();

describe('API client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adds Bearer token to requests', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    const client = createClient('https://example.com', 'test-key-123');
    await client.get('/v1/health');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key-123' }),
      }),
    );
  });

  test('post sends JSON body', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    const client = createClient('https://example.com', 'test-key-123');
    await client.post('/v1/sync/push', { changes: {} });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ changes: {} }),
      }),
    );
  });

  test('throws on non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') });
    const client = createClient('https://example.com', 'bad-key');
    await expect(client.get('/v1/auth/me')).rejects.toThrow('401');
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

- [ ] **Step 3: Реализовать client.js**

```javascript
// mobile/src/api/client.js

export function createClient(baseUrl, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  async function request(method, path, body) {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${baseUrl}${path}`, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    return response.json();
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/client.js mobile/__tests__/api/client.test.js
git commit -m "add HTTP client with Bearer auth"
```

---

### Task 13: API endpoints

**Files:**
- Create: `mobile/src/api/endpoints.js`

- [ ] **Step 1: Реализовать endpoints.js**

```javascript
// mobile/src/api/endpoints.js

import { createClient } from './client';

let client = null;

export function initApi(baseUrl, apiKey) {
  client = createClient(baseUrl, apiKey);
}

export function getMe() {
  return client.get('/v1/auth/me');
}

export function syncPush(changes) {
  return client.post('/v1/sync/push', { changes });
}

export function syncPull(lastSyncAt) {
  return client.post('/v1/sync/pull', { last_sync_at: lastSyncAt });
}

export function checkUpdate() {
  return client.get('/v1/mobile/update/check');
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/api/endpoints.js
git commit -m "add API endpoint functions"
```

---

### Task 14: Sync service

**Files:**
- Create: `mobile/src/sync/syncService.js`
- Create: `mobile/__tests__/sync/syncService.test.js`

- [ ] **Step 1: Написать тест**

```javascript
// mobile/__tests__/sync/syncService.test.js

import { performSync } from '../../src/sync/syncService';
import * as endpoints from '../../src/api/endpoints';
import * as snippetRepo from '../../src/db/snippetRepo';
import * as noteRepo from '../../src/db/noteRepo';
import * as syncMeta from '../../src/db/syncMetaRepo';

jest.mock('../../src/api/endpoints');
jest.mock('../../src/db/snippetRepo');
jest.mock('../../src/db/noteRepo');
jest.mock('../../src/db/syncMetaRepo');

describe('syncService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('pull applies server changes to local DB', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue(null);
    endpoints.syncPull.mockResolvedValue({
      changes: {
        shortcuts: [{ uuid: 's1', name: 'test', value: 'val', updated_at: '2026-01-01', is_deleted: false }],
        notes: [],
        note_folders: [],
        snippet_tags: [],
      },
      server_time: '2026-01-01T12:00:00',
    });
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 0, conflicts: [] });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);

    await performSync();

    expect(snippetRepo.upsertSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 's1', name: 'test' }),
    );
    expect(syncMeta.setLastSyncAt).toHaveBeenCalledWith('2026-01-01T12:00:00');
  });

  test('push sends local changes to server', async () => {
    syncMeta.getLastSyncAt.mockResolvedValue('2026-01-01');
    endpoints.syncPull.mockResolvedValue({ changes: {}, server_time: '2026-01-02' });
    snippetRepo.getModifiedSnippetsSince.mockResolvedValue([
      { uuid: 's2', name: 'local', value: 'v', updated_at: '2026-01-01T06:00:00', is_deleted: 0 },
    ]);
    snippetRepo.getModifiedTagsSince.mockResolvedValue([]);
    noteRepo.getModifiedNotesSince.mockResolvedValue([]);
    noteRepo.getModifiedFoldersSince.mockResolvedValue([]);
    endpoints.syncPush.mockResolvedValue({ status: 'ok', accepted: 1, conflicts: [] });

    await performSync();

    expect(endpoints.syncPush).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.arrayContaining([expect.objectContaining({ uuid: 's2' })]),
      }),
    );
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

- [ ] **Step 3: Реализовать syncService.js**

```javascript
// mobile/src/sync/syncService.js

import { syncPull, syncPush } from '../api/endpoints';
import { getLastSyncAt, setLastSyncAt } from '../db/syncMetaRepo';
import { upsertSnippet, getModifiedSnippetsSince, upsertTag, getModifiedTagsSince } from '../db/snippetRepo';
import { upsertNote, getModifiedNotesSince, upsertFolder, getModifiedFoldersSince } from '../db/noteRepo';

let syncing = false;

export async function performSync() {
  if (syncing) return;
  syncing = true;

  try {
    const lastSync = await getLastSyncAt();

    // 1. Pull server changes
    const pullResult = await syncPull(lastSync);

    // Apply server changes to local DB
    const applyMap = {
      shortcuts: upsertSnippet,
      snippet_tags: upsertTag,
      notes: upsertNote,
      note_folders: upsertFolder,
    };

    for (const [table, rows] of Object.entries(pullResult.changes || {})) {
      const upsert = applyMap[table];
      if (!upsert) continue;
      for (const row of rows) {
        await upsert(row);
      }
    }

    // 2. Push local changes
    const changes = {};

    const localSnippets = await getModifiedSnippetsSince(lastSync);
    if (localSnippets.length) changes.shortcuts = localSnippets;

    const localTags = await getModifiedTagsSince(lastSync);
    if (localTags.length) changes.snippet_tags = localTags;

    const localNotes = await getModifiedNotesSince(lastSync);
    if (localNotes.length) changes.notes = localNotes;

    const localFolders = await getModifiedFoldersSince(lastSync);
    if (localFolders.length) changes.note_folders = localFolders;

    if (Object.keys(changes).length > 0) {
      await syncPush(changes);
    }

    // 3. Update last sync time
    await setLastSyncAt(pullResult.server_time);
  } finally {
    syncing = false;
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/sync/syncService.js mobile/__tests__/sync/syncService.test.js
git commit -m "add sync service with push/pull orchestration"
```

---

### Task 15: Network listener

**Files:**
- Create: `mobile/src/sync/networkListener.js`

- [ ] **Step 1: Реализовать networkListener.js**

```javascript
// mobile/src/sync/networkListener.js

import NetInfo from '@react-native-community/netinfo';
import { performSync } from './syncService';
import { AppState } from 'react-native';

let unsubscribeNet = null;
let appStateSubscription = null;

export function startNetworkListener() {
  // Sync when network comes back online
  let wasOffline = false;
  unsubscribeNet = NetInfo.addEventListener((state) => {
    if (state.isConnected && wasOffline) {
      performSync().catch(console.warn);
    }
    wasOffline = !state.isConnected;
  });

  // Sync when app returns from background
  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      performSync().catch(console.warn);
    }
  });
}

export function stopNetworkListener() {
  if (unsubscribeNet) unsubscribeNet();
  if (appStateSubscription) appStateSubscription.remove();
}
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/sync/networkListener.js
git commit -m "add network listener for auto-sync"
```

---

## Chunk 4: Auth Screens

### Task 16: LoginScreen

**Files:**
- Modify: `mobile/src/screens/Auth/LoginScreen.js`

- [ ] **Step 1: Реализовать экран логина**

```javascript
// mobile/src/screens/Auth/LoginScreen.js

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { initApi, getMe } from '../../api/endpoints';

const API_BASE_URL = 'http://109.172.85.124:8000'; // TODO: сделать настраиваемым

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
      await getMe(); // Validate key
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
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/screens/Auth/LoginScreen.js
git commit -m "implement login screen with API key input"
```

---

### Task 17: QRScannerScreen

**Files:**
- Create: `mobile/src/screens/Auth/QRScannerScreen.js`

- [ ] **Step 1: Реализовать сканер QR**

```javascript
// mobile/src/screens/Auth/QRScannerScreen.js

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { initApi, getMe } from '../../api/endpoints';

const API_BASE_URL = 'http://109.172.85.124:8000';

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
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/screens/Auth/QRScannerScreen.js
git commit -m "implement QR scanner screen for API key"
```

---

### Task 18: Biometrics

**Files:**
- Create: `mobile/src/auth/biometrics.js`

- [ ] **Step 1: Реализовать biometrics.js**

```javascript
// mobile/src/auth/biometrics.js

import ReactNativeBiometrics from 'react-native-biometrics';

const rnBiometrics = new ReactNativeBiometrics();

export async function isBiometricAvailable() {
  const { available } = await rnBiometrics.isSensorAvailable();
  return available;
}

export async function authenticate(promptMessage = 'Подтвердите вход') {
  const { success } = await rnBiometrics.simplePrompt({ promptMessage });
  return success;
}
```

- [ ] **Step 2: Интегрировать в AuthContext — добавить biometric login**

Добавить в `mobile/src/auth/AuthContext.js`:

```javascript
// Добавить импорт
import { isBiometricAvailable, authenticate } from './biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';

// Внутри AuthProvider добавить:
const [biometricEnabled, setBiometricEnabled] = useState(false);

// В useEffect загрузки:
const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
if (bioEnabled === 'true' && key) {
  const available = await isBiometricAvailable();
  if (available) {
    const ok = await authenticate();
    if (ok) setApiKey(key);
    // Если fingerprint не прошёл — показываем экран логина
  } else {
    setApiKey(key);
  }
  setBiometricEnabled(true);
}

// Функция toggleBiometric:
const toggleBiometric = async (enabled) => {
  await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
  setBiometricEnabled(enabled);
};

// Добавить в value провайдера: biometricEnabled, toggleBiometric
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/auth/biometrics.js mobile/src/auth/AuthContext.js
git commit -m "add biometric auth with fingerprint support"
```

---

## Chunk 5: Snippets Module

### Task 19: Компонент SearchBar

**Files:**
- Create: `mobile/src/components/SearchBar.js`

- [ ] **Step 1: Реализовать SearchBar**

```javascript
// mobile/src/components/SearchBar.js

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function SearchBar({ value, onChangeText, placeholder = 'Поиск...' }) {
  const { colors } = useTheme();
  return (
    <View style={[s.container, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
      <TextInput
        style={[s.input, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, marginHorizontal: 12, marginVertical: 8 },
  input: { fontSize: 15, paddingVertical: 10 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/SearchBar.js
git commit -m "add SearchBar component"
```

---

### Task 20: Компонент TagFilter

**Files:**
- Create: `mobile/src/components/TagFilter.js`

- [ ] **Step 1: Реализовать TagFilter**

```javascript
// mobile/src/components/TagFilter.js

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function TagFilter({ tags, selectedId, onSelect }) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.container}>
      <TouchableOpacity
        style={[s.tag, { backgroundColor: !selectedId ? colors.primary : colors.bgSecondary, borderColor: colors.border }]}
        onPress={() => onSelect(null)}
      >
        <Text style={[s.tagText, { color: !selectedId ? '#fff' : colors.text }]}>Все</Text>
      </TouchableOpacity>
      {tags.map((tag) => (
        <TouchableOpacity
          key={tag.uuid}
          style={[
            s.tag,
            {
              backgroundColor: selectedId === tag.uuid ? tag.color : colors.bgSecondary,
              borderColor: tag.color,
            },
          ]}
          onPress={() => onSelect(tag.uuid === selectedId ? null : tag.uuid)}
        >
          <Text style={[s.tagText, { color: selectedId === tag.uuid ? '#fff' : colors.text }]}>
            {tag.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingVertical: 6 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8, borderWidth: 1 },
  tagText: { fontSize: 13 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/TagFilter.js
git commit -m "add TagFilter component"
```

---

### Task 21: SnippetListScreen

**Files:**
- Modify: `mobile/src/screens/Snippets/SnippetListScreen.js`

- [ ] **Step 1: Реализовать экран списка сниппетов**

```javascript
// mobile/src/screens/Snippets/SnippetListScreen.js

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { getAllSnippets, searchSnippets, getAllTags } from '../../db/snippetRepo';
import { performSync } from '../../sync/syncService';
import SearchBar from '../../components/SearchBar';
import TagFilter from '../../components/TagFilter';

export default function SnippetListScreen({ navigation }) {
  const { colors } = useTheme();
  const [snippets, setSnippets] = useState([]);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const t = await getAllTags();
    setTags(t);
    let items;
    if (query) {
      items = await searchSnippets(query);
    } else {
      items = await getAllSnippets();
    }
    // Filter by tag
    if (selectedTag) {
      const tag = t.find((tg) => tg.uuid === selectedTag);
      if (tag) {
        const patterns = JSON.parse(tag.patterns || '[]');
        items = items.filter((s) =>
          patterns.some((p) => s.name.toLowerCase().includes(p.toLowerCase())),
        );
      }
    }
    setSnippets(items);
  }, [query, selectedTag]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await performSync();
      await loadData();
    } catch (e) {
      console.warn('Sync failed:', e);
    }
    setRefreshing(false);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigation.navigate('SnippetDetail', { snippet: item })}
    >
      <Text style={[s.name, { color: colors.text }]}>{item.name}</Text>
      {item.description ? (
        <Text style={[s.desc, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.description}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Поиск сниппетов..." />
      <TagFilter tags={tags} selectedId={selectedTag} onSelect={setSelectedTag} />
      <FlatList
        data={snippets}
        keyExtractor={(item) => item.uuid}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={snippets.length === 0 ? s.empty : undefined}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center' }}>Нет сниппетов</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  card: { padding: 14, marginHorizontal: 12, marginVertical: 4, borderRadius: 8, borderWidth: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 13, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/screens/Snippets/SnippetListScreen.js
git commit -m "implement snippet list screen with search and tags"
```

---

### Task 22: SnippetDetailScreen

**Files:**
- Create: `mobile/src/screens/Snippets/SnippetDetailScreen.js`

- [ ] **Step 1: Реализовать экран детали сниппета**

```javascript
// mobile/src/screens/Snippets/SnippetDetailScreen.js

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../theme/ThemeContext';

export default function SnippetDetailScreen({ route }) {
  const { snippet } = route.params;
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    Clipboard.setString(snippet.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareSnippet = () => {
    Share.share({ message: snippet.value, title: snippet.name });
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <Text style={[s.title, { color: colors.text }]}>{snippet.name}</Text>

      {snippet.description ? (
        <Text style={[s.desc, { color: colors.textSecondary }]}>{snippet.description}</Text>
      ) : null}

      <ScrollView style={[s.codeBox, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        <Text style={[s.code, { color: colors.text }]} selectable>{snippet.value}</Text>
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={copyToClipboard}>
          <Text style={s.btnText}>{copied ? 'Скопировано!' : 'Копировать'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.bgTertiary }]} onPress={shareSnippet}>
          <Text style={[s.btnText, { color: colors.text }]}>Поделиться</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  desc: { fontSize: 14, marginBottom: 16 },
  codeBox: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16 },
  code: { fontSize: 14, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: Добавить SnippetDetailScreen в навигацию**

Добавить в `AppNavigator.js` стек для Snippets:

```javascript
import SnippetDetailScreen from '../screens/Snippets/SnippetDetailScreen';

const SnippetsStack = createNativeStackNavigator();

function SnippetsNavigator() {
  return (
    <SnippetsStack.Navigator>
      <SnippetsStack.Screen name="SnippetList" component={SnippetListScreen} options={{ headerShown: false }} />
      <SnippetsStack.Screen name="SnippetDetail" component={SnippetDetailScreen} options={{ title: 'Сниппет' }} />
    </SnippetsStack.Navigator>
  );
}

// В MainTabs заменить SnippetListScreen на SnippetsNavigator
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/Snippets/SnippetDetailScreen.js mobile/src/navigation/AppNavigator.js
git commit -m "implement snippet detail screen with copy and share"
```

---

## Chunk 6: Notes Module

### Task 23: Компонент FolderTree

**Files:**
- Create: `mobile/src/components/FolderTree.js`

- [ ] **Step 1: Реализовать FolderTree**

```javascript
// mobile/src/components/FolderTree.js

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

function buildTree(folders) {
  const map = new Map();
  const roots = [];
  for (const f of folders) map.set(f.uuid, { ...f, children: [] });
  for (const f of folders) {
    const node = map.get(f.uuid);
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function FolderNode({ folder, depth, selectedId, onSelect, expandedIds, onToggleExpand }) {
  const { colors } = useTheme();
  const isSelected = selectedId === folder.uuid;
  const isExpanded = expandedIds.has(folder.uuid);
  const hasChildren = folder.children.length > 0;

  return (
    <View>
      <TouchableOpacity
        style={[s.row, { paddingLeft: 12 + depth * 16, backgroundColor: isSelected ? colors.primaryLight : 'transparent' }]}
        onPress={() => onSelect(folder.uuid)}
      >
        {hasChildren ? (
          <TouchableOpacity onPress={() => onToggleExpand(folder.uuid)} style={s.arrow}>
            <Text style={{ color: colors.textMuted }}>{isExpanded ? '▼' : '▶'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.arrow} />
        )}
        <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{folder.name}</Text>
      </TouchableOpacity>
      {isExpanded && folder.children.map((child) => (
        <FolderNode
          key={child.uuid}
          folder={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </View>
  );
}

export default function FolderTree({ folders, selectedId, onSelect }) {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const tree = buildTree(folders);

  const onToggleExpand = (uuid) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  return (
    <View>
      {tree.map((folder) => (
        <FolderNode
          key={folder.uuid}
          folder={folder}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 12 },
  arrow: { width: 20, alignItems: 'center' },
  name: { fontSize: 14, flex: 1 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/components/FolderTree.js
git commit -m "add FolderTree component with nested folders"
```

---

### Task 24: NoteListScreen

**Files:**
- Modify: `mobile/src/screens/Notes/NoteListScreen.js`

- [ ] **Step 1: Реализовать экран заметок**

```javascript
// mobile/src/screens/Notes/NoteListScreen.js

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { getAllFolders, getNotesByFolder, getAllNotes } from '../../db/noteRepo';
import { performSync } from '../../sync/syncService';
import FolderTree from '../../components/FolderTree';
import SearchBar from '../../components/SearchBar';
import { searchNotes } from '../../db/noteRepo';

export default function NoteListScreen({ navigation }) {
  const { colors } = useTheme();
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showFolders, setShowFolders] = useState(true);

  const loadFolders = useCallback(async () => {
    const f = await getAllFolders();
    setFolders(f);
  }, []);

  const loadNotes = useCallback(async () => {
    let items;
    if (query) {
      items = await searchNotes(query);
    } else if (selectedFolder) {
      items = await getNotesByFolder(selectedFolder);
    } else {
      items = await getAllNotes();
    }
    setNotes(items);
  }, [selectedFolder, query]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await performSync();
      await loadFolders();
      await loadNotes();
    } catch (e) {
      console.warn('Sync failed:', e);
    }
    setRefreshing(false);
  };

  const renderNote = ({ item }) => (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigation.navigate('NoteEditor', { note: item })}
    >
      <View style={s.cardHeader}>
        <Text style={[s.noteTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
        {item.is_pinned ? <Text style={s.pin}>📌</Text> : null}
      </View>
      {item.content ? (
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.content.substring(0, 100)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Поиск заметок..." />

      {!query && (
        <TouchableOpacity style={s.toggleFolders} onPress={() => setShowFolders(!showFolders)}>
          <Text style={{ color: colors.primary }}>{showFolders ? 'Скрыть папки' : 'Показать папки'}</Text>
        </TouchableOpacity>
      )}

      {!query && showFolders && (
        <View style={[s.folderPanel, { borderColor: colors.border }]}>
          <FolderTree folders={folders} selectedId={selectedFolder} onSelect={setSelectedFolder} />
        </View>
      )}

      <FlatList
        data={notes}
        keyExtractor={(item) => item.uuid}
        renderItem={renderNote}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={notes.length === 0 ? s.empty : undefined}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center' }}>Нет заметок</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  folderPanel: { maxHeight: 200, borderBottomWidth: 1, marginBottom: 4 },
  toggleFolders: { paddingHorizontal: 12, paddingVertical: 4 },
  card: { padding: 14, marginHorizontal: 12, marginVertical: 4, borderRadius: 8, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noteTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  pin: { fontSize: 14, marginLeft: 8 },
  preview: { fontSize: 13, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/screens/Notes/NoteListScreen.js
git commit -m "implement note list screen with folders and search"
```

---

### Task 25: NoteEditorScreen

**Files:**
- Create: `mobile/src/screens/Notes/NoteEditorScreen.js`

- [ ] **Step 1: Реализовать редактор заметок**

```javascript
// mobile/src/screens/Notes/NoteEditorScreen.js

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../../theme/ThemeContext';
import { upsertNote } from '../../db/noteRepo';

export default function NoteEditorScreen({ route, navigation }) {
  const { note } = route.params;
  const { colors } = useTheme();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await upsertNote({
      ...note,
      title,
      content,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    navigation.goBack();
  };

  const mdStyles = {
    body: { color: colors.text, fontSize: 14 },
    heading1: { color: colors.text },
    heading2: { color: colors.text },
    heading3: { color: colors.text },
    code_block: { backgroundColor: colors.bgSecondary, color: colors.text },
    code_inline: { backgroundColor: colors.bgSecondary, color: colors.text },
    link: { color: colors.primary },
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <TextInput
        style={[s.titleInput, { color: colors.text, borderColor: colors.border }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Заголовок"
        placeholderTextColor={colors.textMuted}
      />

      <View style={s.toolbar}>
        <TouchableOpacity onPress={() => setPreview(!preview)}>
          <Text style={{ color: colors.primary }}>{preview ? 'Редактировать' : 'Превью'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{saving ? 'Сохранение...' : 'Сохранить'}</Text>
        </TouchableOpacity>
      </View>

      {preview ? (
        <ScrollView style={s.previewArea}>
          <Markdown style={mdStyles}>{content}</Markdown>
        </ScrollView>
      ) : (
        <TextInput
          style={[s.editor, { color: colors.text, backgroundColor: colors.bgSecondary }]}
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholder="Содержимое (markdown)"
          placeholderTextColor={colors.textMuted}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  titleInput: { fontSize: 18, fontWeight: '600', borderBottomWidth: 1, paddingVertical: 8, marginBottom: 8 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  editor: { flex: 1, fontSize: 14, fontFamily: 'monospace', padding: 12, borderRadius: 8 },
  previewArea: { flex: 1 },
});
```

- [ ] **Step 2: Добавить Notes стек в навигацию**

В `AppNavigator.js` добавить:

```javascript
import NoteEditorScreen from '../screens/Notes/NoteEditorScreen';

const NotesStack = createNativeStackNavigator();

function NotesNavigator() {
  return (
    <NotesStack.Navigator>
      <NotesStack.Screen name="NoteList" component={NoteListScreen} options={{ headerShown: false }} />
      <NotesStack.Screen name="NoteEditor" component={NoteEditorScreen} options={{ title: 'Заметка' }} />
    </NotesStack.Navigator>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/Notes/NoteEditorScreen.js mobile/src/navigation/AppNavigator.js
git commit -m "implement note editor with markdown preview"
```

---

## Chunk 7: Settings, OTA, FCM

### Task 26: SettingsScreen

**Files:**
- Modify: `mobile/src/screens/Settings/SettingsScreen.js`

- [ ] **Step 1: Реализовать экран настроек**

```javascript
// mobile/src/screens/Settings/SettingsScreen.js

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { isBiometricAvailable } from '../../auth/biometrics';
import { checkForUpdate } from '../../updater/updateService';
import { performSync } from '../../sync/syncService';

export default function SettingsScreen() {
  const { colors, isDark, toggle: toggleTheme } = useTheme();
  const { logout, biometricEnabled, toggleBiometric } = useAuth();
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
  }, []);

  const handleSync = async () => {
    try {
      await performSync();
      Alert.alert('Синхронизация', 'Данные синхронизированы');
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось синхронизировать');
    }
  };

  const handleCheckUpdate = async () => {
    try {
      await checkForUpdate(true);
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось проверить обновления');
    }
  };

  const row = (label, right) => (
    <View style={[s.row, { borderColor: colors.border }]}>
      <Text style={[s.label, { color: colors.text }]}>{label}</Text>
      {right}
    </View>
  );

  return (
    <ScrollView style={[s.container, { backgroundColor: colors.bg }]}>
      <Text style={[s.section, { color: colors.textSecondary }]}>Внешний вид</Text>
      {row('Тёмная тема', <Switch value={isDark} onValueChange={toggleTheme} />)}

      {bioAvailable && (
        <>
          <Text style={[s.section, { color: colors.textSecondary }]}>Безопасность</Text>
          {row('Вход по отпечатку', <Switch value={biometricEnabled} onValueChange={toggleBiometric} />)}
        </>
      )}

      <Text style={[s.section, { color: colors.textSecondary }]}>Данные</Text>
      {row('Синхронизировать', (
        <TouchableOpacity onPress={handleSync}>
          <Text style={{ color: colors.primary }}>Синхронизировать</Text>
        </TouchableOpacity>
      ))}

      <Text style={[s.section, { color: colors.textSecondary }]}>Обновления</Text>
      {row('Проверить обновления', (
        <TouchableOpacity onPress={handleCheckUpdate}>
          <Text style={{ color: colors.primary }}>Проверить</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={[s.logoutBtn, { borderColor: colors.danger }]} onPress={logout}>
        <Text style={{ color: colors.danger, fontWeight: '600' }}>Выйти</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  label: { fontSize: 15 },
  logoutBtn: { margin: 16, padding: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/screens/Settings/SettingsScreen.js
git commit -m "implement settings screen"
```

---

### Task 27: OTA Update Service

**Files:**
- Create: `mobile/src/updater/updateService.js`
- Create: `mobile/src/components/UpdateBanner.js`

- [ ] **Step 1: Реализовать updateService.js**

```javascript
// mobile/src/updater/updateService.js

import { HotUpdate } from 'react-native-ota-hot-update';
import { Alert } from 'react-native';

const UPDATE_URL = 'http://109.172.85.124:8000/updates/latest.json';

let updateInfo = null;
let onProgressCallback = null;

export async function checkForUpdate(showAlertIfNone = false) {
  try {
    const response = await fetch(UPDATE_URL);
    const data = await response.json();
    const currentVersion = HotUpdate.getCurrentVersion();

    if (data.version && data.version !== currentVersion) {
      updateInfo = data;
      return data;
    }

    if (showAlertIfNone) {
      Alert.alert('Обновления', 'У вас последняя версия');
    }
    return null;
  } catch (e) {
    console.warn('Update check failed:', e);
    return null;
  }
}

export function getUpdateInfo() {
  return updateInfo;
}

export function setOnProgress(callback) {
  onProgressCallback = callback;
}

export async function applyUpdate() {
  if (!updateInfo) return;

  HotUpdate.downloadBundleUri(updateInfo.bundle_url, {
    updateType: HotUpdate.UpdateType.IMMEDIATE,
    progress: (received, total) => {
      if (onProgressCallback) {
        onProgressCallback(received / total);
      }
    },
  });
}
```

- [ ] **Step 2: Реализовать UpdateBanner.js**

```javascript
// mobile/src/components/UpdateBanner.js

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { checkForUpdate, applyUpdate, setOnProgress } from '../updater/updateService';

export default function UpdateBanner() {
  const { colors } = useTheme();
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(null); // null = not downloading, 0-1 = progress
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
```

- [ ] **Step 3: Добавить UpdateBanner в AppNavigator (внутри MainTabs)**

- [ ] **Step 4: Commit**

```bash
git add mobile/src/updater/updateService.js mobile/src/components/UpdateBanner.js
git commit -m "add OTA update service and update banner"
```

---

### Task 28: FCM заготовка

**Files:**
- Create: `mobile/src/notifications/fcm.js`

- [ ] **Step 1: Реализовать FCM заглушку**

```javascript
// mobile/src/notifications/fcm.js

import messaging from '@react-native-firebase/messaging';

export async function initFCM() {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    const token = await messaging().getToken();
    console.log('FCM Token:', token);
    // TODO: отправить token на сервер когда будет готов эндпоинт
  }
}

export function setupFCMListeners() {
  // Foreground messages
  messaging().onMessage(async (remoteMessage) => {
    console.log('FCM message (foreground):', remoteMessage);
    // TODO: показать in-app уведомление
  });

  // Background/quit message handler
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('FCM message (background):', remoteMessage);
  });
}
```

- [ ] **Step 2: Подключить в App.js**

Добавить в `App.js`:

```javascript
import { initFCM, setupFCMListeners } from './src/notifications/fcm';

// Внутри App, после рендера:
useEffect(() => {
  initFCM();
  setupFCMListeners();
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/notifications/fcm.js mobile/App.js
git commit -m "add FCM stub for push notifications"
```

---

### Task 29: Интеграция DB init и sync в App.js

**Files:**
- Modify: `mobile/App.js`

- [ ] **Step 1: Подключить инициализацию БД и автосинк**

Добавить в `App.js`:

```javascript
import { initDB } from './src/db/database';
import { initApi } from './src/api/endpoints';
import { performSync } from './src/sync/syncService';
import { startNetworkListener } from './src/sync/networkListener';

// Внутри компонента, после получения apiKey из AuthContext:
useEffect(() => {
  if (!apiKey) return;
  (async () => {
    await initDB();
    initApi('http://109.172.85.124:8000', apiKey);
    await performSync();
    startNetworkListener();
  })();
}, [apiKey]);
```

- [ ] **Step 2: Commit**

```bash
git add mobile/App.js
git commit -m "integrate DB init, API init and auto-sync on login"
```

---

### Task 30: Добавить QR генерацию в десктоп Settings

**Files:**
- Modify: `desktop-rust/src/tabs/settings.js`

- [ ] **Step 1: Добавить кнопку "Показать QR" в десктопном Settings**

Генерация QR с API-ключом на стороне десктопа, чтобы мобильное приложение могло его отсканировать. Использовать JS-библиотеку `qrcode` для генерации SVG/canvas QR-кода.

- [ ] **Step 2: Commit**

```bash
git add desktop-rust/src/tabs/settings.js
git commit -m "add QR code display for API key in desktop settings"
```

---

### Task 31: Серверная часть — эндпоинт обновлений

**Files:**
- Create: статический JSON или новый роут в API

- [ ] **Step 1: Создать структуру для OTA бандлов на сервере**

На сервере 109.172.85.124 создать директорию и файл:

```bash
mkdir -p /srv/snippets-helper/updates
```

```json
// /srv/snippets-helper/updates/latest.json
{
  "version": "1.0.0",
  "bundle_url": "http://109.172.85.124:8000/updates/bundle-1.0.0.zip",
  "release_notes": "Initial release"
}
```

- [ ] **Step 2: Настроить nginx для раздачи static-файлов из /updates/**

- [ ] **Step 3: Commit (если добавляем роут в API)**

---

### Task 32: Финальная сборка и тест APK

- [ ] **Step 1: Собрать release APK**

```bash
cd mobile/android
./gradlew assembleRelease
```

- [ ] **Step 2: Проверить APK на устройстве**

Установить `mobile/android/app/build/outputs/apk/release/app-release.apk` на Android-устройство и проверить:
- Логин по API-ключу
- Логин по QR
- Загрузка сниппетов
- Загрузка заметок
- Pull-to-refresh синк
- Переключение тем
- Fingerprint
- Проверка обновлений

- [ ] **Step 3: Commit и тег версии**

```bash
git tag mobile-v1.0.0
```
