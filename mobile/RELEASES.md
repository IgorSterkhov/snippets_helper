# Release & Build Process — Snippets Helper (Mobile / Android)

Source of truth for how the mobile app is built, how OTA works, how the
server pieces fit together. Read this before touching anything in `mobile/`.

Repo: `github.com/IgorSterkhov/snippets_helper`. The React Native app lives
in `mobile/`. There is **no CI for mobile** — all releases are cut manually
from a dev machine with `~/Android/Sdk` installed and SSH access to
`snippets-api`.

---

## 1. Release channels

Two ways to ship code. Pick based on what changed.

### APK release — full rebuild
Required when anything native changed:
- `mobile/android/**` (Manifest, `MainApplication.kt`, Gradle, permissions,
  keystore config, `network_security_config.xml`, resources)
- `mobile/package.json` dependency list (new/removed npm package with
  native modules — autolinking needs to re-run)
- A bug that made the OTA path itself unusable (users can't reach an OTA
  fix without getting a new APK first)

Product: `mobile/android/app/build/outputs/apk/release/app-release.apk`.
Uploaded to `snippets-api:/opt/isterapp/releases/snippets-helper-1.0.0.apk`.
Users download from `https://ister-app.ru/releases/snippets-helper-1.0.0.apk`.

The APK filename is intentionally pinned to `1.0.0` and overwritten every
rebuild — the "version" users see inside the app is the OTA version they're
running.

### OTA release — JS-only update
Required when only `mobile/src/**` or `mobile/App.js` / `mobile/index.js`
changed. The app downloads a new JS bundle, swaps it in, restarts itself.
No reinstall. ~2 seconds.

Cannot ship:
- Native module adds/removes
- New Android permissions
- `MainApplication.kt` / `AndroidManifest.xml` changes
- React Native version bumps
- Anything that needs a fresh Metro → native bridge

If you need any of those, it's an APK release.

---

## 2. Cutting a release — step by step

### 2.1 Pre-flight
```bash
# Repo is clean, on main
cd /home/aster/dev/snippets_helper && git status
```
If dirty, commit or stash first.

### 2.2 OTA release (most common)

`package.json` `version` is the **bundled JS version**. The client compares
it to `latest.json.version` on the server using semver. Bump it.

```bash
# 1. Bump mobile/package.json "version": "1.0.X" → "1.0.X+1"

# 2. Build the bundle
cd /home/aster/dev/snippets_helper/mobile
rm -rf /tmp/ota-bundle /tmp/bundle-1.0.X.zip
mkdir -p /tmp/ota-bundle/output
npx react-native bundle \
    --platform android \
    --dev false \
    --entry-file index.js \
    --bundle-output /tmp/ota-bundle/output/index.android.bundle \
    --assets-dest /tmp/ota-bundle/output/assets

# 3. Zip with the `output/` top-level folder (REQUIRED — see §7)
cd /tmp/ota-bundle && zip -r /tmp/bundle-1.0.X.zip output/

# 4. Upload bundle
scp /tmp/bundle-1.0.X.zip snippets-api:/opt/isterapp/releases/snippets-updates/bundle-1.0.X.zip

# 5. Update manifest
ssh snippets-api 'cat > /opt/isterapp/releases/snippets-updates/latest.json <<JSON
{"version": "1.0.X", "bundle_url": "https://ister-app.ru/snippets-updates/bundle-1.0.X.zip", "release_notes": "..."}
JSON'

# 6. Commit
cd /home/aster/dev/snippets_helper
git add -A mobile/
git commit -m "<subject> (OTA 1.0.X)"
```

Verify:
```bash
curl -s https://ister-app.ru/snippets-updates/latest.json
```
Must return the new JSON.

Then on the device: Settings → Проверить обновления → "Обновление
доступно 1.0.X" → Обновить. The app downloads, swaps, restarts.

### 2.3 APK release

```bash
# 1. Set mobile/package.json "version" to the BASELINE (NOT the next OTA).
#    Everyone installing the APK starts at this version. Convention: "1.0.0".
# 2. Bump mobile/android/app/build.gradle → versionCode (e.g. 2 → 3).
#    Android refuses to install "same version" sometimes — always bump.
# 3. Patch sqlite-storage (see §7.1). Every npm install reverts this.
sed -i 's/jcenter()/mavenCentral()/g' \
  /home/aster/dev/snippets_helper/mobile/node_modules/react-native-sqlite-storage/platforms/android/build.gradle

# 4. Build
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
cd /home/aster/dev/snippets_helper/mobile/android
./gradlew assembleRelease

# 5. Upload (overwrite existing APK)
scp app/build/outputs/apk/release/app-release.apk \
    snippets-api:/opt/isterapp/releases/snippets-helper-1.0.0.apk

# 6. Commit the native/deps changes
git add -A mobile/
git commit -m "<subject> (APK)"
```

### 2.4 APK + OTA together
Common flow after an APK release: ship an OTA with a higher version so the
very next "check for updates" has something to apply.

1. APK release with `package.json = "1.0.0"` (baseline) and `versionCode`
   bumped. Commit.
2. Then bump `package.json` to `"1.0.1"` and follow §2.2 for the OTA.
3. Two commits, two artifacts.

---

## 3. Version management (how semver flows)

| Piece | Where | Used for |
| --- | --- | --- |
| `versionCode` | `mobile/android/app/build.gradle` | Android installer — must bump each APK |
| `versionName` | same | Cosmetic Android metadata |
| `package.json` `version` | `mobile/package.json` | Metro bundles this into JS as `BUNDLED_VERSION` (read by `updateService.js`) |
| `installed_ota_version` | AsyncStorage key | Set after a successful OTA apply — overrides `BUNDLED_VERSION` when newer |
| `latest.json` `version` | Server | What the app compares against |

Effective current version in the app = `max(BUNDLED_VERSION, installed_ota_version)`
using a hand-rolled semver compare (`1.0.10` > `1.0.9`). Code lives in
`src/updater/updateService.js`.

**Never** set `package.json` `version` past the server's `latest.json`
when building an APK — the APK would immediately look "up to date" and
OTA would never suggest anything.

---

## 4. Local development

### 4.1 Metro dev server (when you have a device)
```bash
cd mobile
npm start          # Metro on http://localhost:8081
```
On an attached debug-built APK, shake → Reload. Release APKs load the
bundled JS only; Metro won't help.

### 4.2 Build a debug APK for a connected device
Rare — we usually iterate via OTA against the release APK on a phone.
```bash
cd mobile/android
./gradlew installDebug
```

### 4.3 Jest
```bash
cd mobile && npm test
```
Covers `__tests__/db/`, `__tests__/sync/`, `__tests__/api/`.

### 4.4 Testing an OTA bundle before publishing
You can't easily do this without a second server path. Acceptable
practice: upload under a different version like `1.99.0-rc`, point a
throwaway `latest.json` to it, test, then cut the real version.

---

## 5. OTA architecture in one page

Uses [`react-native-ota-hot-update`](https://github.com/vantuan88291/react-native-ota-hot-update) v2.4.0.

### 5.1 Required wiring (any of these missing → OTA silently broken)

`mobile/android/app/src/main/java/com/snippetshelper/MainApplication.kt`
**must** pass the hot-update bundle path when creating the React host:
```kotlin
import com.otahotupdate.OtaHotUpdate

override val reactHost: ReactHost by lazy {
  getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages,
    jsBundleFilePath = OtaHotUpdate.bundleJS(applicationContext),
  )
}
```
Without this the freshly-downloaded bundle sits on disk and the app keeps
loading the APK-bundled JS.

`mobile/android/app/src/main/AndroidManifest.xml` needs:
- `<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />`
- `android:requestLegacyExternalStorage="true"` on `<application>`

`mobile/package.json` must include `react-native-blob-util` — the library
uses it as the download manager. Install once with
`npm install react-native-blob-util`.

### 5.2 How a check + apply runs

`src/updater/updateService.js`:
1. `checkForUpdate()` reads saved `api_base_url` → derives
   `https://<host>/snippets-updates/latest.json` → fetches.
2. Compares `data.version` vs effective installed version (see §3).
3. On "available", stashes the manifest in module-local `updateInfo`.
4. `applyUpdate()` calls
   `hotUpdate.downloadBundleUri(ReactNativeBlobUtil, url, numericVersion, { extensionBundle: '.bundle', restartAfterInstall: true, progress, updateSuccess, updateFail })`.
5. The library downloads the zip to cache, extracts, finds the file with
   `.bundle` extension, writes a `SharedPrefs` pointer, restarts the app.
6. `updateSuccess` callback sets `installed_ota_version` in AsyncStorage.

### 5.3 Bundle format (important)

The zip **must** contain a single top-level folder:
```
bundle-1.0.X.zip
└── output/
    ├── index.android.bundle
    └── assets/
        └── ...
```
The library uses the top-level folder name for its version history. A
flat zip technically extracts but skips the history bookkeeping. Always
zip `output/` as a directory, not its contents.

`extensionBundle` in the JS call **must** be `.bundle`. If you pass
`.zip`, the library looks for a file with `.zip` extension *after*
extraction and finds nothing → "File unzip failed" silent in release.

### 5.4 Triggers

`checkForUpdate()` runs from three places:
- On mount of `UpdateBanner` (top of `MainTabs` in `AppNavigator.js`) —
  gives the banner at the top of the screen.
- Settings → "Проверить обновления" (shows an Alert either way).
- Nowhere else — no background polling.

---

## 6. Infrastructure

### 6.1 Server (`snippets-api`, `109.172.85.124`)
Domain: `ister-app.ru` (A record → same IP). Let's Encrypt cert for the
domain; renewed by `certbot.timer` in the host. Nginx runs in the
`isterapp_nginx` container; config lives on the host at
`/opt/isterapp/backend/nginx/conf.d/isterapp.conf`.

| Public URL | Served from |
| --- | --- |
| `https://ister-app.ru/snippets-api/*` | `snippets_api` container port 8001 (FastAPI) |
| `https://ister-app.ru/releases/*` | `/opt/isterapp/releases/` (static) |
| `https://ister-app.ru/snippets-updates/*` | `/opt/isterapp/releases/snippets-updates/` (aliased in nginx) |

### 6.2 Copying LE cert into the container
`/opt/ssl` is mounted read-only into `isterapp_nginx`. We copy
`/etc/letsencrypt/live/ister-app.ru/fullchain.pem` and `privkey.pem` into
`/opt/ssl/snippets.crt` and `snippets.key` (overwriting the old self-signed
cert) and reload nginx:
```bash
ssh snippets-api '
  cp /etc/letsencrypt/live/ister-app.ru/fullchain.pem /opt/ssl/snippets.crt
  cp /etc/letsencrypt/live/ister-app.ru/privkey.pem  /opt/ssl/snippets.key
  docker exec isterapp_nginx nginx -s reload
'
```
Until certbot auto-renew is wired to also copy+reload, this is manual
every ~90 days. (TODO.)

### 6.3 Firebase (push notifications, stubbed)
`mobile/android/app/google-services.json` is git-ignored and lives on the
dev machine. FCM init runs at startup (`src/notifications/fcm.js`) and
logs the token — nothing is sent server-side yet.

---

## 7. Known gotchas

### 7.1 `react-native-sqlite-storage` uses deprecated `jcenter()`
Its bundled Android `build.gradle` (inside `node_modules/`) references
`jcenter()`, which Gradle 9 removed. Symptom:
`Could not find method jcenter() for arguments [] on repository container`.

Patch it every time after `npm install` (npm overwrites node_modules):
```bash
sed -i 's/jcenter()/mavenCentral()/g' \
  mobile/node_modules/react-native-sqlite-storage/platforms/android/build.gradle
```
No upstream fix is expected. Consider switching to `react-native-quick-sqlite`
or `op-sqlite` long-term.

### 7.2 React Native New Architecture ignores `network_security_config.xml`
Self-signed certs won't work. `OkHttpClientProvider.setOkHttpClientFactory`
doesn't work either in new arch. That's why we went Let's Encrypt —
anything else burns a full day chasing a phantom.

### 7.3 `package.json` version drives the OTA compare
Not `versionName`, not `versionCode`. Metro inlines `package.json.version`
into the bundle via the `import { version as BUNDLED_VERSION } from '../../package.json'`
line in `updateService.js`. If the two are out of sync you get infinite
"update available" loops (server newer) or silent "up to date" (bundle
newer).

### 7.4 APK builds need specific version state in `package.json`
When building the APK, `package.json.version` becomes `BUNDLED_VERSION`
for that APK. If it's already at the next OTA version, newly installed
users will not see the OTA as an upgrade. Build APK at the baseline
(e.g. `1.0.0`), *then* bump `package.json` and ship the OTA.

### 7.5 Biometric login — flow is stateful
`AuthContext` loads the API key, but if `biometric_enabled=true` it parks
the key in `storedKey` and sets `lockedBehindBiometric=true`. The
`BiometricLockScreen` shows; on success the key moves into `apiKey`.
This means: `useAuth().apiKey` stays `null` until the fingerprint
prompt completes. Any code path that assumed "app loaded → apiKey set"
needs to also handle `lockedBehindBiometric=true`.

### 7.6 `getNotesByFolder` filters by `folder_uuid`
Server `Note` table still has legacy `folder_id` (int) alongside
`folder_uuid` (UUID). Mobile schema drops `folder_id`. A note with only
`folder_id` but no `folder_uuid` on the server will show up as
"loose" in the mobile app (no folder assignment). If this matters, the
fix is server-side backfill.

### 7.7 Folder hierarchy on mobile needs `id` + `parent_id`
The API sends both `id` (int, per-user unique) and `parent_id` (int,
references `id`). Mobile SQLite has both columns and `buildTree()` in
`src/components/FolderTree.js` matches on `id`. Earlier migrations
forgot `id`; if you ever see flat folders after a schema change, check
that `upsertFolder` and the `note_folders` table both have it.

### 7.8 FolderTree children inherit a stale top-level state on refocus
`useFocusEffect` reloads folders on tab focus. If you add lazy loading
or virtualization in `FolderPicker`, remember that FolderTree maintains
its own expanded-ids `Set` in state — preserve/reset it intentionally.

### 7.9 `sync_meta.last_sync_at` is reset by the DB migration
The current `initDB()` runs an `ALTER TABLE note_folders ADD COLUMN id`
migration on first boot after 1.0.1 and then *calls* `setLastSyncAt(null)`
to force a full pull. If you add future migrations that require a full
re-sync, follow the same pattern; otherwise don't touch `last_sync_at`.

### 7.10 OkHttp client caching of DNS / SSL
A running app caches TLS sessions. If you rotate the server cert and
the app had been running beforehand, it may fail to reconnect until
fully killed (swipe away, not just backgrounded). Not a bug — noting it
for the next cert rotation.

---

## 8. Signing & credentials

### 8.1 Release keystore
```
File:     mobile/android/app/release.keystore   (gitignored)
Alias:    snippets-helper
Password: stored in ~/.gradle/gradle.properties (NOT in repo)
```

`~/.gradle/gradle.properties` must contain:
```
SNIPPETS_RELEASE_STORE_FILE=/home/aster/dev/snippets_helper/mobile/android/app/release.keystore
SNIPPETS_RELEASE_STORE_PASSWORD=<secret>
SNIPPETS_RELEASE_KEY_ALIAS=snippets-helper
SNIPPETS_RELEASE_KEY_PASSWORD=<same secret>
```
`build.gradle` reads those; no fallback. If they're missing, `./gradlew
assembleRelease` crashes with "Keystore file not found".

### 8.2 Losing the keystore
Loss = can never ship another signed upgrade with the same signature.
Users would have to uninstall the app to install a new APK (and lose
their encrypted `api_key` in the process). Back it up.

### 8.3 API key storage
`src/auth/AuthContext.js` uses `react-native-encrypted-storage` (Android
Keystore-backed) for the API key. Biometric enable/disable goes through
`AsyncStorage` — the biometric flag isn't the secret; the key is.

---

## 9. Debugging in production

### 9.1 `adb logcat`
Device in USB debug:
```bash
adb logcat *:S ReactNativeJS:V ReactNative:V
```
`updateService.js` no longer logs the exact error to the UI by default —
`Alert.alert('Ошибка', String(e))` is stripped from the current flow.
If reopening the diagnostic version helps, temporarily re-enable it
before a bundle cut.

### 9.2 Quick endpoint checks
```bash
# OTA manifest
curl -s https://ister-app.ru/snippets-updates/latest.json
# API health
curl -s https://ister-app.ru/snippets-api/v1/health
# APK download
curl -sI https://ister-app.ru/releases/snippets-helper-1.0.0.apk
```
All three should 200.

### 9.3 Force a full re-sync from the device
Log out → log back in. On fresh auth, `last_sync_at` is `NULL`, so
`performSync` pulls everything and rebuilds local state.

Alternatively: clear the app data in Android settings. Destroys encrypted
key, too — user will need to re-enter the key or scan QR again.

### 9.4 Roll back a bad OTA
Easiest: bump `package.json` to a higher version than the bad one, ship
an OTA with fixed code. Users auto-update on next "Проверить обновления".

If the bad OTA makes the app crash on startup, the library's
crash-handler rolls back to the previous bundle automatically (that's
the point of `OtaHotUpdate.bundleJS(ctx, true)` default behaviour). On
persistent crashes across OTAs: delete the app's data directory
(`/data/data/com.snippetshelper/files/` via adb) — resets to the
APK-bundled JS.

---

## 10. Pre-release checklist

Before any APK release:
- [ ] `package.json.version` is the baseline the APK will ship with (usually `1.0.0`)
- [ ] `android/app/build.gradle` `versionCode` bumped
- [ ] `sqlite-storage/build.gradle` patched (jcenter → mavenCentral)
- [ ] Required native changes (if any) landed: `MainApplication.kt`,
      `AndroidManifest.xml`, new permissions, new native modules
- [ ] `~/.gradle/gradle.properties` has the signing props
- [ ] Server manifests (`latest.json`) won't suddenly advertise a higher
      version the new APK can't reach

Before any OTA release:
- [ ] Only `src/` / `App.js` / `index.js` / `package.json.version` changed
- [ ] No dependency adds/removes that affect native code
- [ ] `package.json.version` bumped
- [ ] New mutations call `notifyLocalChange()` after `upsert*` where the
      user expects near-real-time sync
- [ ] Bundle zipped with `output/` top-level folder
- [ ] `latest.json` bundle URL points at the newly-uploaded file
      (version matches, path exists)
- [ ] Manual device test: Settings → Проверить обновления → Обновить,
      app restarts, behaves
- [ ] Git commit with `(OTA X.Y.Z)` suffix for grep-ability

When **not** to release:
- `git status` is dirty with unrelated changes
- `npm install` was run and the sqlite-storage patch wasn't reapplied
- Server cert is mid-renewal
- You're changing signing keys, Firebase config, or the OTA URL scheme
  — those need their own discussion

---

## 11. Important files

| Path | Purpose |
| --- | --- |
| `src/updater/updateService.js` | OTA check + apply, version compare |
| `src/sync/syncService.js` | Pull/push, `notifyLocalChange`, pending counter |
| `src/sync/useSyncStatus.js` | React hook for `SyncStatusBar` |
| `src/auth/AuthContext.js` | API key storage, biometric lock flow |
| `src/db/database.js` | SQLite init + migrations |
| `App.js` | Root providers, triggers `initDB`, `initApi`, `performSync`, `startNetworkListener` |
| `android/app/src/main/java/com/snippetshelper/MainApplication.kt` | Must call `OtaHotUpdate.bundleJS()` |
| `android/app/src/main/AndroidManifest.xml` | Permissions + `network_security_config` |
| `android/app/build.gradle` | `versionCode`, signing configs |
| `android/gradle.properties` | Global Gradle options (release props live in `~/.gradle/gradle.properties`) |
| `package.json` | `version` = `BUNDLED_VERSION` for OTA compare |

---

## 12. Future work / known debt

- FCM token is generated and logged but never sent to the server — no
  server endpoint yet.
- No snippet / tag / folder editing UI in the mobile app. Only notes can
  be created and edited. When adding CRUD for the others, call
  `notifyLocalChange()` after every `upsert*`.
- `SettingsScreen`'s "Проверить обновления" doesn't show a progress bar
  during `applyUpdate` — only the in-top banner does. Consolidate.
- Mobile has no CI. Every release is manual-from-dev. If this grows,
  wiring up a GitHub Action with a self-hosted runner (or a Docker image
  with Android SDK) is the play.
- Cert renewal is manual (see §6.2).
