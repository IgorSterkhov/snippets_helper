#!/bin/bash

# Название приложения
APP_NAME="Keyboard Helper.app"
CONTENTS_DIR="$APP_NAME/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

# Создаем структуру директорий
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# Создаем Info.plist
cat > "$CONTENTS_DIR/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>start_helper</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.keyboardhelper.app</string>
    <key>CFBundleName</key>
    <string>Keyboard Helper</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.10</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

# Копируем файлы проекта
cp main.py "$RESOURCES_DIR/"
cp requirements.txt "$RESOURCES_DIR/"
cp .env "$RESOURCES_DIR/"
cp -r .venv "$RESOURCES_DIR/"

# Создаем скрипт запуска
cat > "$MACOS_DIR/start_helper" << EOF
#!/bin/bash
cd "\$(dirname "\$0")/../Resources"
source .venv/bin/activate
python main.py
EOF

# Делаем скрипт запуска исполняемым
chmod +x "$MACOS_DIR/start_helper"

# Генерируем иконку
python3 create_icon.py

# Конвертируем набор иконок в .icns
iconutil -c icns AppIcon.iconset

# Перемещаем иконку в ресурсы
mv AppIcon.icns "$RESOURCES_DIR/"

# Очищаем временные файлы
rm -rf AppIcon.iconset

echo "Application bundle created successfully!" 