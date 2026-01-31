"""Cross-platform autostart manager for Keyboard Helper."""

import platform
import os
import sys
from pathlib import Path


class AutostartManager:
    """Manages application autostart on Windows and macOS."""

    def __init__(self, app_name: str, script_path: str = None):
        """
        Initialize autostart manager.

        Args:
            app_name: Application name (used for shortcut/plist naming)
            script_path: Path to main.py script. If None, uses current script.
        """
        self.app_name = app_name
        self.script_path = script_path or str(Path(__file__).parent / "main.py")
        self.system = platform.system()

    def is_enabled(self) -> bool:
        """Check if autostart is enabled."""
        if self.system == "Windows":
            return self._windows_is_enabled()
        elif self.system == "Darwin":
            return self._macos_is_enabled()
        return False

    def enable(self) -> bool:
        """Enable autostart. Returns True on success."""
        if self.system == "Windows":
            return self._windows_enable()
        elif self.system == "Darwin":
            return self._macos_enable()
        return False

    def disable(self) -> bool:
        """Disable autostart. Returns True on success."""
        if self.system == "Windows":
            return self._windows_disable()
        elif self.system == "Darwin":
            return self._macos_disable()
        return False

    # === Windows Implementation ===

    def _windows_startup_folder(self) -> Path:
        """Get Windows Startup folder path."""
        return Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup"

    def _windows_shortcut_path(self) -> Path:
        """Get path for the shortcut file."""
        return self._windows_startup_folder() / f"{self.app_name}.lnk"

    def _windows_is_enabled(self) -> bool:
        """Check if Windows shortcut exists in Startup folder."""
        return self._windows_shortcut_path().exists()

    def _windows_enable(self) -> bool:
        """Create shortcut in Windows Startup folder."""
        try:
            from win32com.client import Dispatch

            shortcut_path = self._windows_shortcut_path()
            shortcut_path.parent.mkdir(parents=True, exist_ok=True)

            shell = Dispatch("WScript.Shell")
            shortcut = shell.CreateShortCut(str(shortcut_path))

            # Use pythonw.exe to avoid console window
            python_exe = sys.executable
            pythonw_exe = python_exe.replace("python.exe", "pythonw.exe")
            if Path(pythonw_exe).exists():
                shortcut.Targetpath = pythonw_exe
            else:
                shortcut.Targetpath = python_exe

            shortcut.Arguments = f'"{self.script_path}"'
            shortcut.WorkingDirectory = str(Path(self.script_path).parent)
            shortcut.Description = self.app_name

            # Set icon if .ico exists
            ico_path = Path(self.script_path).parent / "AppIcon.ico"
            if ico_path.exists():
                shortcut.IconLocation = str(ico_path)

            shortcut.save()
            return True
        except Exception as e:
            print(f"Failed to enable Windows autostart: {e}")
            return False

    def _windows_disable(self) -> bool:
        """Remove shortcut from Windows Startup folder."""
        try:
            shortcut_path = self._windows_shortcut_path()
            if shortcut_path.exists():
                shortcut_path.unlink()
            return True
        except Exception as e:
            print(f"Failed to disable Windows autostart: {e}")
            return False

    # === macOS Implementation ===

    def _macos_plist_path(self) -> Path:
        """Get path for LaunchAgent plist file."""
        return Path.home() / "Library/LaunchAgents" / f"com.{self.app_name.lower().replace(' ', '')}.plist"

    def _macos_is_enabled(self) -> bool:
        """Check if macOS LaunchAgent plist exists."""
        return self._macos_plist_path().exists()

    def _macos_enable(self) -> bool:
        """Create macOS LaunchAgent plist."""
        try:
            plist_path = self._macos_plist_path()
            plist_path.parent.mkdir(parents=True, exist_ok=True)

            label = f"com.{self.app_name.lower().replace(' ', '')}"

            plist_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{sys.executable}</string>
        <string>{self.script_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>{Path(self.script_path).parent}</string>
</dict>
</plist>'''

            plist_path.write_text(plist_content, encoding="utf-8")
            return True
        except Exception as e:
            print(f"Failed to enable macOS autostart: {e}")
            return False

    def _macos_disable(self) -> bool:
        """Remove macOS LaunchAgent plist."""
        try:
            plist_path = self._macos_plist_path()
            if plist_path.exists():
                plist_path.unlink()
            return True
        except Exception as e:
            print(f"Failed to disable macOS autostart: {e}")
            return False
