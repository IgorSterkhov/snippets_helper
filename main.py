import os
import faulthandler
import getpass
import platform
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
import pyperclip
import tkinter as tk
from tkinter import ttk, filedialog
from pynput import keyboard
from threading import Timer
from database import Database
from handlers.sql_parser import parse_sql

faulthandler.enable()


class MultiDirSelectDialog:
    """Custom dialog for selecting multiple directories with checkboxes."""

    def __init__(self, parent, initial_dir=None, title="Select Folders"):
        self.parent = parent
        self.result = []
        self.current_path = Path(initial_dir) if initial_dir else Path.home()
        self.checked_items = set()

        self.dialog = tk.Toplevel(parent)
        self.dialog.title(title)
        self.dialog.geometry("500x400")
        self.dialog.transient(parent)
        self.dialog.grab_set()

        self._build_ui()
        self._populate_tree()

        self.dialog.protocol("WM_DELETE_WINDOW", self._on_cancel)
        self.dialog.wait_window()

    def _build_ui(self):
        # Path navigation frame
        nav_frame = ttk.Frame(self.dialog)
        nav_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        self.up_btn = ttk.Button(nav_frame, text="Up", width=5, command=self._go_up)
        self.up_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.path_var = tk.StringVar(value=str(self.current_path))
        self.path_entry = ttk.Entry(nav_frame, textvariable=self.path_var, state="readonly")
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # Treeview frame
        tree_frame = ttk.Frame(self.dialog)
        tree_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        # Treeview with checkboxes
        self.tree = ttk.Treeview(tree_frame, columns=("check",), show="tree headings", selectmode="none")
        self.tree.heading("#0", text="Folder")
        self.tree.heading("check", text="Select")
        self.tree.column("#0", width=350)
        self.tree.column("check", width=60, anchor="center")

        scrollbar = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind("<Double-1>", self._on_double_click)
        self.tree.bind("<Button-1>", self._on_click)

        # Buttons frame
        btn_frame = ttk.Frame(self.dialog)
        btn_frame.pack(fill=tk.X, padx=10, pady=(5, 10))

        ttk.Button(btn_frame, text="Cancel", command=self._on_cancel).pack(side=tk.RIGHT, padx=(5, 0))
        ttk.Button(btn_frame, text="OK", command=self._on_ok).pack(side=tk.RIGHT)

    def _populate_tree(self):
        self.tree.delete(*self.tree.get_children())
        self.path_var.set(str(self.current_path))

        try:
            items = sorted(self.current_path.iterdir(), key=lambda p: p.name.lower())
            folders = [item for item in items if item.is_dir() and not item.name.startswith(".")]
        except PermissionError:
            folders = []

        for folder in folders:
            check_mark = "☑" if folder.name in self.checked_items else "☐"
            self.tree.insert("", tk.END, text=folder.name, values=(check_mark,), iid=folder.name)

    def _on_click(self, event):
        region = self.tree.identify_region(event.x, event.y)
        column = self.tree.identify_column(event.x)
        item = self.tree.identify_row(event.y)

        if item and column == "#1":  # Click on "check" column
            folder_name = item
            if folder_name in self.checked_items:
                self.checked_items.remove(folder_name)
                self.tree.set(item, "check", "☐")
            else:
                self.checked_items.add(folder_name)
                self.tree.set(item, "check", "☑")

    def _on_double_click(self, event):
        item = self.tree.identify_row(event.y)
        column = self.tree.identify_column(event.x)

        if item and column != "#1":  # Double click not on check column - navigate
            new_path = self.current_path / item
            if new_path.is_dir():
                self.checked_items.clear()
                self.current_path = new_path
                self._populate_tree()

    def _go_up(self):
        parent = self.current_path.parent
        if parent != self.current_path:
            self.checked_items.clear()
            self.current_path = parent
            self._populate_tree()

    def _on_ok(self):
        self.result = list(self.checked_items)
        self.dialog.destroy()

    def _on_cancel(self):
        self.result = []
        self.dialog.destroy()


class KeyboardHelper:
    def __init__(self):
        # Create main window but keep it hidden
        self.root = tk.Tk()
        self.root.withdraw()  # Hide the main window
        
        self.window = None
        self.items_dict = []
        self.selected_item = None
        self.last_shift_press = 0
        self.shift_pressed = False
        self.shift_timer = None
        
        # Initialize database
        self.db = Database()
        self.sql_table_analyzer_templates = self.db.get_sql_table_analyzer_templates()
        self.superset_computer_id = self._get_superset_computer_id()
        self.sql_parser_last_dir = str(Path.home())
        
        # Initial data load
        self.load_items()
        
        # Setup keyboard listeners
        self.keyboard_listener = keyboard.Listener(
            on_press=self.on_press,
            on_release=self.on_release)
        self.keyboard_listener.start()
        
    def load_items(self):
        self.items_dict = self.db.get_all_items()

    def save_item(self):
        if self.selected_item is not None:
            for item in self.items_dict:
                if item['id'] == self.selected_item:
                    item['name'] = self.shortcut_name.get()
                    item['value'] = self.shortcut_value.get('1.0', tk.END).rstrip()
                    item['description'] = self.shortcut_description.get('1.0', tk.END).rstrip()
                    # Update only the modified item in the database
                    self.db.update_item(item)
                    break
            self.filter_items()

    def create_new_item(self):
        max_id = max([item['id'] for item in self.items_dict]) if self.items_dict else 0
        new_item = {
            'id': max_id + 1,
            'name': self.shortcut_name.get(),
            'value': self.shortcut_value.get('1.0', tk.END).rstrip(),
            'description': self.shortcut_description.get('1.0', tk.END).rstrip()
        }
        # Create new item in the database
        self.db.create_item(new_item)
        self.items_dict.append(new_item)
        self.filter_items()

    def delete_item(self):
        if self.selected_item is not None:
            # Delete item from the database
            self.db.delete_item(self.selected_item)
            self.items_dict = [item for item in self.items_dict if item['id'] != self.selected_item]
            self.selected_item = None
            self.shortcut_name.delete(0, tk.END)
            self.shortcut_value.delete('1.0', tk.END)
            self.shortcut_description.delete('1.0', tk.END)
            self.filter_items()

    def on_press(self, key):
        try:
            if key == keyboard.Key.shift:
                import time
                current_time = time.time()
                
                if not self.shift_pressed:
                    self.shift_pressed = True
                    if current_time - self.last_shift_press < 0.3:
                        # Double shift detected
                        if self.window:
                            self._schedule_destroy_window()
                        else:
                            self._schedule_create_window()
                    self.last_shift_press = current_time
            elif key == keyboard.Key.esc and self.window:
                self._schedule_destroy_window()
        except AttributeError:
            pass

    def on_release(self, key):
        if key == keyboard.Key.shift:
            self.shift_pressed = False

    def filter_items(self, *args):
        search_text = self.inputter.get().lower()
        self.selector.delete(0, tk.END)
        
        for item in self.items_dict:
            if search_text in item['name'].lower():
                self.selector.insert(tk.END, item['name'])

    def on_select(self, event):
        if not self.selector.curselection():
            return
            
        selected_name = self.selector.get(self.selector.curselection())
        for item in self.items_dict:
            if item['name'] == selected_name:
                self.selected_item = item['id']
                self.shortcut_name.delete(0, tk.END)
                self.shortcut_name.insert(0, item['name'])
                self.shortcut_value.delete('1.0', tk.END)
                self.shortcut_value.insert('1.0', item['value'])
                self.shortcut_description.delete('1.0', tk.END)
                self.shortcut_description.insert('1.0', item.get('description', ''))
                break

    def copy_to_clipboard(self, event=None):
        if self.selected_item is not None:
            for item in self.items_dict:
                if item['id'] == self.selected_item:
                    pyperclip.copy(item['value'])
                    break
        self.destroy_window(None)

    def create_window(self):
        if self.window:
            return

        self.window = tk.Toplevel(self.root)
        self.window.title("Keyboard Helper")
        self.window.geometry("600x600")  # Увеличили высоту окна для нового поля
        
        # macOS specific window settings
        self.window.lift()
        self.window.attributes('-topmost', True)
        
        # Ensure window appears on the active Space in macOS
        self.window.update_idletasks()

        # Notebook (tabs)
        self.notebook = ttk.Notebook(self.window)
        self.notebook.pack(fill=tk.BOTH, expand=True)

        # --- Tab 1: Snippets ---
        snippets_frame = ttk.Frame(self.notebook)
        self.notebook.add(snippets_frame, text="Snippets")
        self._build_snippets_tab(snippets_frame)

        # --- Tab 2: SQL parser ---
        sql_frame = ttk.Frame(self.notebook)
        self.notebook.add(sql_frame, text="SQL parser")
        self._build_sql_tab(sql_frame)

        # --- Tab 3: SQL Table Analyzer ---
        sql_table_analyzer_frame = ttk.Frame(self.notebook)
        self.notebook.add(sql_table_analyzer_frame, text="SQL Table Analyzer")
        self._build_sql_table_analyzer_tab(sql_table_analyzer_frame)

        # --- Tab 4: Superset ---
        superset_frame = ttk.Frame(self.notebook)
        self.notebook.add(superset_frame, text="Superset")
        self._build_superset_tab(superset_frame)

        # Ctrl+Tab and Ctrl+Shift+Tab to switch tabs (универсально для всех виджетов)
        self._bind_ctrl_tab_to_all(self.window)

        # Set initial focus
        # self.inputter.focus_set()
        self.filter_items()

    def _schedule_create_window(self):
        if self.root:
            self.root.after(0, self.create_window)

    def _bind_ctrl_tab_to_all(self, parent):
        for child in parent.winfo_children():
            # Рекурсивно для Frame/LabelFrame/ttk.Frame и т.д.
            if isinstance(child, (tk.Frame, ttk.Frame, tk.LabelFrame)):
                self._bind_ctrl_tab_to_all(child)
            # Для всех виджетов, которые могут получать фокус
            child.bind('<Control-Tab>', self._ctrl_tab, add='+')
            # child.bind('<Control-ISO_Left_Tab>', self._ctrl_tab_reverse, add='+')

    def _ctrl_tab(self, event):
        current = self.notebook.index(self.notebook.select())
        total = len(self.notebook.tabs())
        self.notebook.select((current + 1) % total)
        return "break"

    def _ctrl_tab_reverse(self, event):
        current = self.notebook.index(self.notebook.select())
        total = len(self.notebook.tabs())
        self.notebook.select((current - 1) % total)
        return "break"

    def _build_snippets_tab(self, parent):
        # Left side
        left_frame = ttk.Frame(parent)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.inputter = ttk.Entry(left_frame)
        self.inputter.pack(fill=tk.X, pady=(0, 5))
        self.inputter.bind('<KeyRelease>', self.filter_items)

        self.selector = tk.Listbox(left_frame)
        self.selector.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        self.selector.bind('<<ListboxSelect>>', self.on_select)

        self.clipboard_btn = ttk.Button(left_frame, text="Copy to Clipboard", command=self.copy_to_clipboard)
        self.clipboard_btn.pack(fill=tk.X, pady=(0, 5))

        self.save_btn = ttk.Button(left_frame, text="Save", command=self.save_item)
        self.save_btn.pack(fill=tk.X, pady=(0, 5))

        self.create_new_btn = ttk.Button(left_frame, text="Create New", command=self.create_new_item)
        self.create_new_btn.pack(fill=tk.X, pady=(0, 5))

        self.delete_btn = ttk.Button(left_frame, text="Delete", command=self.delete_item)
        self.delete_btn.pack(fill=tk.X)

        # Right side
        right_frame = ttk.Frame(parent)
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Name field
        name_frame = ttk.Frame(right_frame)
        name_frame.pack(fill=tk.X, pady=(0, 5))
        name_label = ttk.Label(name_frame, text="Name:")
        name_label.pack(anchor=tk.W)
        self.shortcut_name = ttk.Entry(name_frame)
        self.shortcut_name.pack(fill=tk.X)

        # Value field
        value_frame = ttk.Frame(right_frame)
        value_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        value_label = ttk.Label(value_frame, text="Value:")
        value_label.pack(anchor=tk.W)
        self.shortcut_value = tk.Text(value_frame, height=10)
        self.shortcut_value.pack(fill=tk.BOTH, expand=True)

        # Description field
        description_frame = ttk.Frame(right_frame)
        description_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        description_label = ttk.Label(description_frame, text="Description:")
        description_label.pack(anchor=tk.W)
        self.shortcut_description = tk.Text(description_frame, height=10)
        self.shortcut_description.pack(fill=tk.BOTH, expand=True)

        # Bind keyboard shortcuts
        self.window.bind('<Return>', self.copy_to_clipboard)
        self.window.bind('<Escape>', self._schedule_destroy_window)
        
        # Setup tab order
        widget_order = [
            self.inputter,
            self.selector,
            self.save_btn,
            self.clipboard_btn,
            self.create_new_btn,
            self.delete_btn,
            self.shortcut_name,
            self.shortcut_value,
            self.shortcut_description
        ]
        
        for i, widget in enumerate(widget_order):
            widget.lift()

    def _build_sql_tab(self, parent):
        # SQL code input
        self.sql_code_text = tk.Text(parent, height=10, name="sql_code_text")
        self.sql_code_text.pack(fill=tk.X, padx=10, pady=(10, 5))
        # Folder selection row
        sql_folder_frame = ttk.Frame(parent)
        sql_folder_frame.pack(fill=tk.X, padx=10, pady=(0, 5))
        self.sql_folder_entry = ttk.Entry(sql_folder_frame, name="sql_folder_entry")
        self.sql_folder_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        sql_folder_btn = ttk.Button(
            sql_folder_frame,
            text="Choose...",
            command=self._choose_sql_parser_folder
        )
        sql_folder_btn.pack(side=tk.LEFT, padx=(5, 0))
        # Parse button
        self.sql_parse_btn = ttk.Button(parent, text="Parse SQL", command=self._on_sql_parse, name="sql_parse_btn")
        self.sql_parse_btn.pack(fill=tk.X, padx=10, pady=(0, 5))
        # Result output (expand to fill all remaining space)
        self.sql_parse_result_text = tk.Text(parent, name="sql_parse_result_text")
        self.sql_parse_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.sql_parse_result_text.config(state=tk.DISABLED)

    def _on_sql_parse(self):
        sql_code = self.sql_code_text.get("1.0", tk.END).strip()
        if not sql_code:
            folder = self.sql_folder_entry.get().strip()
            if folder:
                sql_code = self._read_text_files_from_folder(folder)
            else:
                sql_code = ""
        result = parse_sql(sql_code) if sql_code else "No SQL text or folder files found."
        self.sql_parse_result_text.config(state=tk.NORMAL)
        self.sql_parse_result_text.delete("1.0", tk.END)
        self.sql_parse_result_text.insert(tk.END, result)
        self.sql_parse_result_text.config(state=tk.DISABLED)

    def _choose_sql_parser_folder(self):
        initial_dir = self.sql_folder_entry.get().strip() or self.sql_parser_last_dir or str(Path.home())
        if self.window:
            self.window.attributes('-topmost', False)
        try:
            selected = filedialog.askdirectory(
                parent=self.window,
                initialdir=initial_dir
            )
        finally:
            if self.window:
                self.window.attributes('-topmost', True)
        if selected:
            self.sql_parser_last_dir = selected
            self.sql_folder_entry.delete(0, tk.END)
            self.sql_folder_entry.insert(0, selected)

    def _read_text_files_from_folder(self, folder_path):
        text_extensions = {
            ".txt", ".sql", ".json", ".yaml", ".yml", ".csv", ".tsv",
            ".xml", ".log", ".ini", ".cfg", ".conf", ".md"
        }
        collected = []
        for root, _, files in os.walk(folder_path):
            for filename in files:
                if Path(filename).suffix.lower() not in text_extensions:
                    continue
                file_path = Path(root) / filename
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as handle:
                        content = handle.read()
                except OSError:
                    continue
                if content.strip():
                    collected.append(f"\n-- FILE: {file_path}\n{content}")
        return "\n".join(collected).strip()

    def _build_sql_table_analyzer_tab(self, parent):
        ddl_label = ttk.Label(parent, text="DDL (ClickHouse):")
        ddl_label.pack(anchor=tk.W, padx=10, pady=(10, 2))
        self.sql_table_ddl_text = tk.Text(parent, height=10, name="sql_table_ddl_text")
        self.sql_table_ddl_text.pack(fill=tk.X, padx=10, pady=(0, 8))

        filter_label = ttk.Label(parent, text="Filter (WHERE ...):")
        filter_label.pack(anchor=tk.W, padx=10, pady=(0, 2))
        self.sql_table_filter_entry = ttk.Entry(parent, name="sql_table_filter_entry")
        self.sql_table_filter_entry.pack(fill=tk.X, padx=10, pady=(0, 8))
        self.sql_table_filter_entry.insert(0, "WHERE True")

        row_version_label = ttk.Label(parent, text="Field for row_version:")
        row_version_label.pack(anchor=tk.W, padx=10, pady=(0, 2))
        self.sql_table_row_version_entry = ttk.Entry(parent, name="sql_table_row_version_entry")
        self.sql_table_row_version_entry.pack(fill=tk.X, padx=10, pady=(0, 8))
        self.sql_table_row_version_entry.insert(0, "row_version")

        buttons_frame = ttk.Frame(parent)
        buttons_frame.pack(fill=tk.X, padx=10, pady=(0, 8))
        self.sql_table_analyze_btn = ttk.Button(
            buttons_frame,
            text="Parse and Analyze",
            command=self._on_sql_table_analyze
        )
        self.sql_table_analyze_btn.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 5))
        self.sql_table_settings_btn = ttk.Button(
            buttons_frame,
            text="Settings",
            command=self._open_sql_table_analyzer_settings
        )
        self.sql_table_settings_btn.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))

        result_label = ttk.Label(parent, text="Result:")
        result_label.pack(anchor=tk.W, padx=10, pady=(0, 2))
        self.sql_table_result_text = tk.Text(parent, name="sql_table_result_text")
        self.sql_table_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.sql_table_result_text.config(state=tk.DISABLED)

        self.sql_table_settings_window = None
        self.sql_table_format_vertical_var = tk.BooleanVar(value=True)

    def _build_superset_tab(self, parent):
        top_frame = ttk.Frame(parent)
        top_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        self.superset_repo_entry = self._create_superset_path_row(
            top_frame,
            "BASE_DESTINATION_PATH",
            "Superset Repo:"
        )
        report_frame = ttk.Frame(top_frame)
        report_frame.pack(fill=tk.X, pady=(0, 8))
        report_label = ttk.Label(report_frame, text="Report folder:")
        report_label.pack(anchor=tk.W)
        report_entry_frame = ttk.Frame(report_frame)
        report_entry_frame.pack(fill=tk.X)
        self.superset_report_folder_entry = ttk.Entry(report_entry_frame)
        self.superset_report_folder_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        report_browse_btn = ttk.Button(
            report_entry_frame,
            text="Choose...",
            command=self._choose_superset_report_folder
        )
        report_browse_btn.pack(side=tk.LEFT, padx=(5, 0))

        superset_notebook = ttk.Notebook(parent)
        superset_notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=(0, 5))

        export_frame = ttk.Frame(superset_notebook)
        superset_notebook.add(export_frame, text="Экспорт отчета")
        self._build_superset_export_tab(export_frame)

        validation_frame = ttk.Frame(superset_notebook)
        superset_notebook.add(validation_frame, text="Валидация отчета")
        self._build_superset_validation_tab(validation_frame)

        sql_parse_frame = ttk.Frame(superset_notebook)
        superset_notebook.add(sql_parse_frame, text="SQL")
        self._build_superset_sql_tab(sql_parse_frame)

    def _build_superset_export_tab(self, parent):
        form_frame = ttk.Frame(parent)
        form_frame.pack(fill=tk.X, padx=10, pady=(5, 5))

        self.superset_archive_dir_entry = self._create_superset_path_row(
            form_frame,
            "ARCHIVE_DIR",
            "Archive directory:"
        )
        self.superset_base_source_entry = self._create_superset_path_row(
            form_frame,
            "BASE_SOURCE_PATH",
            "Base source path:"
        )
        files_frame = ttk.Frame(parent)
        files_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 5))

        files_header = ttk.Frame(files_frame)
        files_header.pack(fill=tk.X)
        files_label = ttk.Label(files_header, text="Latest ZIP files:")
        files_label.pack(side=tk.LEFT)
        refresh_btn = ttk.Button(
            files_header,
            text="Refresh",
            command=self._refresh_superset_file_list
        )
        refresh_btn.pack(side=tk.RIGHT)

        self.superset_files_listbox = tk.Listbox(files_frame, height=6)
        self.superset_files_listbox.pack(fill=tk.BOTH, expand=False, pady=(5, 5))
        self.superset_files_listbox.bind("<<ListboxSelect>>", self._on_superset_select_file)

        export_btn = ttk.Button(parent, text="Экспорт", command=self._on_superset_export)
        export_btn.pack(fill=tk.X, padx=10, pady=(0, 5))

        self.superset_status_text = tk.Text(parent, height=8)
        self.superset_status_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.superset_status_text.config(state=tk.DISABLED)

        self.superset_selected_file_path = None
        self._load_superset_settings()
        self._refresh_superset_file_list()

    def _build_superset_validation_tab(self, parent):
        validate_btn = ttk.Button(parent, text="Validate", command=self._on_superset_validate)
        validate_btn.pack(fill=tk.X, padx=10, pady=(10, 5))

        self.superset_validation_text = tk.Text(parent, height=12)
        self.superset_validation_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.superset_validation_text.tag_configure("error", foreground="red")
        self.superset_validation_text.config(state=tk.DISABLED)

    def _build_superset_sql_tab(self, parent):
        folder_frame = ttk.Frame(parent)
        folder_frame.pack(fill=tk.X, padx=10, pady=(10, 5))
        folder_label = ttk.Label(folder_frame, text="Folder to parse:")
        folder_label.pack(anchor=tk.W)
        folder_entry_frame = ttk.Frame(folder_frame)
        folder_entry_frame.pack(fill=tk.X)
        self.superset_sql_folder_entry = ttk.Entry(folder_entry_frame)
        self.superset_sql_folder_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        folder_browse_btn = ttk.Button(
            folder_entry_frame,
            text="Choose...",
            command=self._choose_superset_sql_folder
        )
        folder_browse_btn.pack(side=tk.LEFT, padx=(5, 0))
        folder_multi_btn = ttk.Button(
            folder_entry_frame,
            text="Multiple...",
            command=self._choose_superset_sql_folders_multiple
        )
        folder_multi_btn.pack(side=tk.LEFT, padx=(5, 0))
        folder_clear_btn = ttk.Button(
            folder_entry_frame,
            text="Clear",
            command=self._clear_superset_sql_folders
        )
        folder_clear_btn.pack(side=tk.LEFT, padx=(5, 0))

        parse_btn = ttk.Button(parent, text="Parse Superset SQL", command=self._on_superset_parse_sql)
        parse_btn.pack(fill=tk.X, padx=10, pady=(5, 5))

        self.superset_sql_result_text = tk.Text(parent)
        self.superset_sql_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.superset_sql_result_text.config(state=tk.DISABLED)

        report_folder = self.superset_report_folder_entry.get().strip()
        if report_folder:
            self.superset_sql_folder_entry.insert(0, report_folder)

    def _create_superset_path_row(self, parent, setting_key, label_text):
        row_frame = ttk.Frame(parent)
        row_frame.pack(fill=tk.X, pady=(0, 8))
        label = ttk.Label(row_frame, text=label_text)
        label.pack(anchor=tk.W)

        entry_frame = ttk.Frame(row_frame)
        entry_frame.pack(fill=tk.X)
        entry = ttk.Entry(entry_frame)
        entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        browse_btn = ttk.Button(
            entry_frame,
            text="Choose...",
            command=lambda: self._choose_superset_directory(setting_key, entry)
        )
        browse_btn.pack(side=tk.LEFT, padx=(5, 0))
        return entry

    def _choose_superset_directory(self, setting_key, entry):
        initial_dir = entry.get().strip() or str(Path.home())
        if self.window:
            self.window.attributes('-topmost', False)
        try:
            selected = filedialog.askdirectory(
                parent=self.window,
                initialdir=initial_dir
            )
        finally:
            if self.window:
                self.window.attributes('-topmost', True)
        if selected:
            entry.delete(0, tk.END)
            entry.insert(0, selected)
            self._save_superset_setting(setting_key, selected)
            if setting_key == "BASE_SOURCE_PATH":
                self._refresh_superset_file_list()

    def _choose_superset_report_folder(self):
        base_destination = self.superset_repo_entry.get().strip()
        initial_dir = base_destination or str(Path.home())
        if self.window:
            self.window.attributes('-topmost', False)
        try:
            selected = filedialog.askdirectory(
                parent=self.window,
                initialdir=initial_dir
            )
        finally:
            if self.window:
                self.window.attributes('-topmost', True)
        if selected:
            report_name = Path(selected).name
            self.superset_report_folder_entry.delete(0, tk.END)
            self.superset_report_folder_entry.insert(0, report_name)

    def _choose_superset_sql_folder(self):
        base_destination = self.superset_repo_entry.get().strip()
        initial_dir = base_destination or str(Path.home())
        if self.window:
            self.window.attributes('-topmost', False)
        try:
            selected = filedialog.askdirectory(
                parent=self.window,
                initialdir=initial_dir
            )
        finally:
            if self.window:
                self.window.attributes('-topmost', True)
        if selected:
            folder_name = Path(selected).name
            current = self.superset_sql_folder_entry.get().strip()
            if current:
                existing = [f.strip() for f in current.split(",") if f.strip()]
                if folder_name not in existing:
                    existing.append(folder_name)
                new_value = ", ".join(existing)
            else:
                new_value = folder_name
            self.superset_sql_folder_entry.delete(0, tk.END)
            self.superset_sql_folder_entry.insert(0, new_value)

    def _choose_superset_sql_folders_multiple(self):
        base_destination = self.superset_repo_entry.get().strip()
        initial_dir = base_destination or str(Path.home())
        if self.window:
            self.window.attributes('-topmost', False)
        try:
            dialog = MultiDirSelectDialog(
                self.window,
                initial_dir=initial_dir,
                title="Select Multiple Folders"
            )
            selected_folders = dialog.result
        finally:
            if self.window:
                self.window.attributes('-topmost', True)

        if selected_folders:
            current = self.superset_sql_folder_entry.get().strip()
            if current:
                existing = [f.strip() for f in current.split(",") if f.strip()]
            else:
                existing = []
            for folder_name in selected_folders:
                if folder_name not in existing:
                    existing.append(folder_name)
            new_value = ", ".join(existing)
            self.superset_sql_folder_entry.delete(0, tk.END)
            self.superset_sql_folder_entry.insert(0, new_value)

    def _clear_superset_sql_folders(self):
        self.superset_sql_folder_entry.delete(0, tk.END)

    def _on_superset_parse_sql(self):
        base_destination = self.superset_repo_entry.get().strip()
        folders_str = self.superset_sql_folder_entry.get().strip()

        if not base_destination:
            self._set_superset_sql_result("Superset Repo is empty.")
            return
        if not folders_str:
            self._set_superset_sql_result("Folder to parse is empty.")
            return

        folders = [f.strip() for f in folders_str.split(",") if f.strip()]
        all_sql_blocks = []
        all_sql_combined = []

        for folder_name in folders:
            folder_path = Path(base_destination) / folder_name
            datasets_path = folder_path / "datasets"

            if not datasets_path.is_dir():
                all_sql_blocks.append(f"# {folder_name}: datasets folder not found\n")
                continue

            yaml_files = list(datasets_path.rglob("*.yaml")) + list(datasets_path.rglob("*.yml"))
            if not yaml_files:
                all_sql_blocks.append(f"# {folder_name}: no yaml files found in datasets\n")
                continue

            for yaml_file in yaml_files:
                sql_content = self._extract_sql_from_yaml(yaml_file)
                if sql_content:
                    file_name = yaml_file.name
                    all_sql_blocks.append(f"-- FILE: {file_name}\n{sql_content}\n")
                    all_sql_combined.append(sql_content)

        result_parts = []
        if all_sql_blocks:
            result_parts.append("=" * 50)
            result_parts.append("SQL QUERIES FROM YAML FILES")
            result_parts.append("=" * 50)
            result_parts.append("")
            result_parts.extend(all_sql_blocks)

        if all_sql_combined:
            combined_sql = "\n".join(all_sql_combined)
            tables_dicts = parse_sql(combined_sql)
            if tables_dicts:
                result_parts.append("")
                result_parts.append("=" * 50)
                result_parts.append("TABLES AND DICTS SUMMARY")
                result_parts.append("=" * 50)
                result_parts.append(tables_dicts)

        if result_parts:
            self._set_superset_sql_result("\n".join(result_parts))
        else:
            self._set_superset_sql_result("No SQL found in specified folders.")

    def _extract_sql_from_yaml(self, yaml_path):
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                content = f.read()
        except OSError:
            return None

        match = re.search(r'^sql:\s*(.+?)(?=^\w+:|\Z)', content, re.MULTILINE | re.DOTALL)
        if not match:
            match = re.search(r'^sql:\s*[|>]-?\s*\n(.*?)(?=^\w+:|\Z)', content, re.MULTILINE | re.DOTALL)

        if not match:
            return None

        sql_block = match.group(1) if match.lastindex else match.group(0)
        sql_block = sql_block.strip()
        sql_block = sql_block.encode('utf-8').decode('unicode_escape', errors='replace')
        sql_block = sql_block.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\r', '\n')

        return sql_block

    def _set_superset_sql_result(self, text):
        self.superset_sql_result_text.config(state=tk.NORMAL)
        self.superset_sql_result_text.delete("1.0", tk.END)
        self.superset_sql_result_text.insert(tk.END, text)
        self.superset_sql_result_text.config(state=tk.DISABLED)

    def _get_superset_computer_id(self):
        return f"{getpass.getuser()}@{platform.node()}"

    def _get_superset_default_settings(self):
        if platform.system().lower().startswith("win"):
            return {
                "ARCHIVE_DIR": "/mnt/c/DevWB/SUPERSET/archive",
                "BASE_SOURCE_PATH": "/mnt/c/Users/Sterhov.Igor/Downloads",
                "BASE_DESTINATION_PATH": "/mnt/c/DevWB/SUPERSET/superset/reports"
            }
        return {
            "ARCHIVE_DIR": str(Path.home() / "DevWB/Superset/archive"),
            "BASE_SOURCE_PATH": str(Path.home() / "Downloads"),
            "BASE_DESTINATION_PATH": str(Path.home() / "DevWB/Superset/superset/reports")
        }

    def _load_superset_settings(self):
        settings = self.db.get_superset_settings(self.superset_computer_id)
        defaults = self._get_superset_default_settings()

        archive_dir = settings.get("ARCHIVE_DIR", defaults.get("ARCHIVE_DIR", ""))
        base_source = settings.get("BASE_SOURCE_PATH", defaults.get("BASE_SOURCE_PATH", ""))
        base_destination = settings.get("BASE_DESTINATION_PATH", defaults.get("BASE_DESTINATION_PATH", ""))

        self.superset_archive_dir_entry.delete(0, tk.END)
        self.superset_archive_dir_entry.insert(0, archive_dir)
        self.superset_base_source_entry.delete(0, tk.END)
        self.superset_base_source_entry.insert(0, base_source)
        self.superset_repo_entry.delete(0, tk.END)
        self.superset_repo_entry.insert(0, base_destination)

    def _save_superset_setting(self, setting_key, setting_value):
        self.db.upsert_superset_setting(self.superset_computer_id, setting_key, setting_value)

    def _refresh_superset_file_list(self):
        base_source_path = self.superset_base_source_entry.get().strip()
        self.superset_files_listbox.delete(0, tk.END)
        self.superset_selected_file_path = None

        if not base_source_path:
            self._set_superset_status("BASE_SOURCE_PATH is empty.")
            return

        source_dir = Path(base_source_path)
        if not source_dir.is_dir():
            self._set_superset_status(f"Source directory not found: {source_dir}")
            return

        zip_files = sorted(
            source_dir.glob("*.zip"),
            key=lambda path: path.stat().st_mtime,
            reverse=True
        )[:5]

        self.superset_latest_files = zip_files
        if not zip_files:
            self._set_superset_status("No ZIP files found in source directory.")
            return

        for zip_file in zip_files:
            mtime = datetime.fromtimestamp(zip_file.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            self.superset_files_listbox.insert(tk.END, f"{zip_file.name} | {mtime}")
        self.superset_files_listbox.selection_set(0)
        self.superset_selected_file_path = zip_files[0]

    def _on_superset_select_file(self, event):
        selection = self.superset_files_listbox.curselection()
        if not selection:
            return
        index = selection[0]
        if 0 <= index < len(self.superset_latest_files):
            self.superset_selected_file_path = self.superset_latest_files[index]

    def _set_superset_status(self, message):
        self.superset_status_text.config(state=tk.NORMAL)
        self.superset_status_text.delete("1.0", tk.END)
        self.superset_status_text.insert(tk.END, message)
        self.superset_status_text.config(state=tk.DISABLED)

    def _append_superset_status(self, message):
        self.superset_status_text.config(state=tk.NORMAL)
        self.superset_status_text.insert(tk.END, message + "\n")
        self.superset_status_text.see(tk.END)
        self.superset_status_text.config(state=tk.DISABLED)

    def _set_superset_validation_output(self, message):
        self.superset_validation_text.config(state=tk.NORMAL)
        self.superset_validation_text.delete("1.0", tk.END)
        self.superset_validation_text.insert(tk.END, message)
        self.superset_validation_text.config(state=tk.DISABLED)

    def _append_superset_validation_output(self, message, is_error=False):
        self.superset_validation_text.config(state=tk.NORMAL)
        start_index = self.superset_validation_text.index(tk.END)
        self.superset_validation_text.insert(tk.END, message + "\n")
        if is_error:
            end_index = self.superset_validation_text.index(tk.END)
            self.superset_validation_text.tag_add("error", start_index, end_index)
        self.superset_validation_text.see(tk.END)
        self.superset_validation_text.config(state=tk.DISABLED)

    def _on_superset_validate(self):
        base_destination = self.superset_repo_entry.get().strip()
        report_dir = self.superset_report_folder_entry.get().strip()

        self._set_superset_validation_output("")

        if not base_destination:
            self._set_superset_validation_output("Superset Repo is empty.")
            return
        if not report_dir:
            self._set_superset_validation_output("Report folder is empty.")
            return

        base_path = Path(base_destination) / report_dir
        self._validate_directory(str(base_path), report_dir)

    def _validate_directory(self, base_path, report_dir):
        X = report_dir.replace("report_", "").replace("_ST", "") + "."
        X_dots = X.replace("_", ".")
        name_con = report_dir.replace("_ST", "")

        if not os.path.isdir(base_path):
            self._append_superset_validation_output(
                f"Ошибка: Директория '{base_path}' не существует.",
                is_error=True
            )
            return

        for root, dirs, files in os.walk(base_path):
            for folder in dirs:
                folder_path = os.path.join(root, folder)
                if folder == "datasets":
                    self._validate_datasets(folder_path, name_con, X_dots)
                elif folder == "databases":
                    self._validate_databases(folder_path, name_con)
                elif folder == "dashboards":
                    self._validate_dashboards(folder_path, X_dots)
                elif folder == "charts":
                    self._validate_charts(folder_path, X_dots)
            break

    def _validate_datasets(self, folder_path, report_dir, X):
        self._append_superset_validation_output(f"Проверяем папку 'datasets': {folder_path}")
        subfolders = [f for f in os.listdir(folder_path) if os.path.isdir(os.path.join(folder_path, f))]

        all_no_dictionaries = True
        all_no_bad_where_in = True

        for subfolder in subfolders:
            if not subfolder.startswith(report_dir):
                self._append_superset_validation_output(
                    f"Ошибка: В папке 'datasets' найдена вложенная папка '{subfolder}', которая не начинается с '{report_dir}'.",
                    is_error=True
                )

        for subfolder in subfolders:
            subfolder_path = os.path.join(folder_path, subfolder)
            files = os.listdir(subfolder_path)
            for file in files:
                if not file.startswith(X):
                    self._append_superset_validation_output(
                        f"Ошибка: Файл '{file}' в папке '{subfolder}' не начинается с '{X}'.",
                        is_error=True
                    )

                file_path = os.path.join(subfolder_path, file)
                if os.path.isfile(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                    except Exception as exc:
                        self._append_superset_validation_output(
                            f"Ошибка при чтении файла '{file_path}': {exc}",
                            is_error=True
                        )
                        continue

                    if 'dictionaries' in content:
                        self._append_superset_validation_output(
                            f"Ошибка: В файле '{file_path}' найдено запрещённое слово 'dictionaries'.",
                            is_error=True
                        )
                        all_no_dictionaries = False

                    if re.search(r'where_in(?!_strip)', content):
                        self._append_superset_validation_output(
                            f"Ошибка: В файле '{file_path}' найдено запрещённое слово 'where_in', не являющееся частью 'where_in_strip'.",
                            is_error=True
                        )
                        all_no_bad_where_in = False

        if all_no_dictionaries:
            self._append_superset_validation_output(
                "Все файлы успешно прошли проверку на отсутствие слова 'dictionaries'."
            )
        if all_no_bad_where_in:
            self._append_superset_validation_output(
                "Все файлы успешно прошли проверку на отсутствие некорректного использования 'where_in'."
            )

        self._append_superset_validation_output("Папка 'datasets' проверена успешно.")

    def _validate_databases(self, folder_path, report_dir):
        self._append_superset_validation_output(f"Проверяем папку 'databases': {folder_path}")
        yaml_file = f"{report_dir}.yaml"
        yaml_path = os.path.join(folder_path, yaml_file)

        if not os.path.isfile(yaml_path):
            self._append_superset_validation_output(
                f"Ошибка: В папке 'databases' отсутствует файл '{yaml_file}'.",
                is_error=True
            )
            return

        try:
            with open(yaml_path, "r") as f:
                lines = f.readlines()
        except Exception as exc:
            self._append_superset_validation_output(
                f"Ошибка при чтении файла '{yaml_file}': {exc}",
                is_error=True
            )
            return

        if len(lines) < 2:
            self._append_superset_validation_output(
                f"Ошибка: Файл '{yaml_file}' содержит недостаточно строк.",
                is_error=True
            )

        expected_first_line = f"database_name: {report_dir}"
        if lines and lines[0].strip() != expected_first_line:
            self._append_superset_validation_output(
                f"Ошибка: Первая строка файла '{yaml_file}' должна быть '{expected_first_line}', но она другая.",
                is_error=True
            )

        expected_second_line_start = f"sqlalchemy_uri: clickhouse+native://cc_{report_dir}"
        if len(lines) > 1 and not lines[1].strip().startswith(expected_second_line_start):
            self._append_superset_validation_output(
                f"Ошибка: Вторая строка файла '{yaml_file}' должна начинаться с '{expected_second_line_start}', но она другая.",
                is_error=True
            )

    def _validate_dashboards(self, folder_path, X):
        self._append_superset_validation_output(f"Проверяем папку 'dashboards': {folder_path}")
        files = os.listdir(folder_path)

        if len(files) != 1:
            self._append_superset_validation_output(
                f"Ошибка: В папке 'dashboards' должен быть только один файл, но найдено {len(files)}.",
                is_error=True
            )

        if files:
            file = files[0]
            if not file.startswith(X):
                self._append_superset_validation_output(
                    f"Ошибка: Файл '{file}' в папке 'dashboards' не начинается с '{X}'.",
                    is_error=True
                )

    def _validate_charts(self, folder_path, X):
        self._append_superset_validation_output(f"Проверяем папку 'charts': {folder_path}")
        files = os.listdir(folder_path)

        if not files:
            self._append_superset_validation_output("Ошибка: Папка 'charts' пуста.", is_error=True)

        for file in files:
            if not file.startswith(X):
                self._append_superset_validation_output(
                    f"Ошибка: Файл '{file}' в папке 'charts' не начинается с '{X}'.",
                    is_error=True
                )

    def _on_superset_export(self):
        archive_dir = self.superset_archive_dir_entry.get().strip()
        base_source = self.superset_base_source_entry.get().strip()
        base_destination = self.superset_repo_entry.get().strip()
        destination_value = self.superset_report_folder_entry.get().strip()

        self._set_superset_status("")

        if not archive_dir or not base_source or not base_destination:
            self._set_superset_status("Archive/Base paths must be filled.")
            return
        if not destination_value:
            self._set_superset_status("Destination folder name is empty.")
            return

        self._save_superset_setting("ARCHIVE_DIR", archive_dir)
        self._save_superset_setting("BASE_SOURCE_PATH", base_source)
        self._save_superset_setting("BASE_DESTINATION_PATH", base_destination)

        source_dir = Path(base_source)
        if not source_dir.is_dir():
            self._set_superset_status(f"Source directory not found: {source_dir}")
            return

        destination_dir = Path(base_destination) / destination_value
        if not destination_dir.is_dir():
            self._set_superset_status(f"Destination directory not found: {destination_dir}")
            return

        archive_path = Path(archive_dir)
        if not archive_path.exists():
            archive_path.mkdir(parents=True, exist_ok=True)

        selected_zip = self.superset_selected_file_path
        if not selected_zip:
            if not hasattr(self, "superset_latest_files") or not self.superset_latest_files:
                self._refresh_superset_file_list()
            selected_zip = self.superset_latest_files[0] if self.superset_latest_files else None
        if not selected_zip:
            self._set_superset_status("No ZIP file selected or available.")
            return

        if selected_zip.suffix.lower() != ".zip":
            self._set_superset_status(f"Selected file is not a ZIP: {selected_zip}")
            return

        try:
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            archive_name = f"{destination_dir.name}_{timestamp}"
            archive_full = archive_path / f"{archive_name}.zip"

            self._append_superset_status(f"Archiving: {destination_dir} -> {archive_full}")
            shutil.make_archive(str(archive_path / archive_name), "zip", root_dir=destination_dir)

            self._append_superset_status(f"Cleaning destination: {destination_dir}")
            for item in destination_dir.iterdir():
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()

            self._append_superset_status("Extracting selected archive...")
            with tempfile.TemporaryDirectory() as tmp_dir:
                with zipfile.ZipFile(selected_zip, "r") as zip_ref:
                    zip_ref.extractall(tmp_dir)

                tmp_path = Path(tmp_dir)
                inner_folder = next((p for p in tmp_path.iterdir() if p.is_dir()), None)
                if not inner_folder:
                    self._set_superset_status("No inner folder found in the ZIP archive.")
                    return

                self._append_superset_status(f"Copying from {inner_folder} to {destination_dir}")
                for item in inner_folder.iterdir():
                    destination_item = destination_dir / item.name
                    if item.is_dir():
                        shutil.copytree(item, destination_item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, destination_item)

            metadata_path = destination_dir / "metadata.yaml"
            if metadata_path.exists():
                metadata_path.unlink()

            self._append_superset_status("Export completed successfully.")
        except Exception as exc:
            self._set_superset_status(f"Export failed: {exc}")

    def _open_sql_table_analyzer_settings(self):
        if self.sql_table_settings_window and self.sql_table_settings_window.winfo_exists():
            self.sql_table_settings_window.lift()
            return

        if self.window:
            self.window.attributes('-topmost', False)
        self.sql_table_settings_window = tk.Toplevel(self.window)
        self.sql_table_settings_window.title("SQL Table Analyzer Settings")
        self.sql_table_settings_window.geometry("600x400")
        self.sql_table_settings_window.transient(self.window)
        self.sql_table_settings_window.attributes('-topmost', True)
        self.sql_table_settings_window.lift()
        self.sql_table_settings_window.focus_force()
        self.sql_table_settings_window.protocol(
            "WM_DELETE_WINDOW",
            self._close_sql_table_analyzer_settings
        )

        format_vertical_check = ttk.Checkbutton(
            self.sql_table_settings_window,
            text="Format Vertical",
            variable=self.sql_table_format_vertical_var
        )
        format_vertical_check.pack(anchor=tk.W, padx=10, pady=(10, 2))

        templates_label = ttk.Label(self.sql_table_settings_window, text="Templates (one per line):")
        templates_label.pack(anchor=tk.W, padx=10, pady=(10, 2))

        self.sql_table_settings_text = tk.Text(self.sql_table_settings_window, height=15)
        self.sql_table_settings_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 8))

        save_btn = ttk.Button(
            self.sql_table_settings_window,
            text="Save",
            command=self._save_sql_table_analyzer_settings
        )
        save_btn.pack(fill=tk.X, padx=10, pady=(0, 10))

        self.sql_table_analyzer_templates = self.db.get_sql_table_analyzer_templates()
        templates_text = "\n".join(self.sql_table_analyzer_templates)
        if templates_text:
            self.sql_table_settings_text.insert("1.0", templates_text)

    def _save_sql_table_analyzer_settings(self):
        templates_text = self.sql_table_settings_text.get("1.0", tk.END).strip()
        templates = [line.strip() for line in templates_text.splitlines() if line.strip()]
        self.db.save_sql_table_analyzer_templates(templates)
        self.sql_table_analyzer_templates = templates
        self._close_sql_table_analyzer_settings()

    def _close_sql_table_analyzer_settings(self):
        if self.sql_table_settings_window and self.sql_table_settings_window.winfo_exists():
            self.sql_table_settings_window.destroy()
            self.sql_table_settings_window = None
        if self.window:
            self.window.attributes('-topmost', True)

    def _on_sql_table_analyze(self):
        ddl_text = self.sql_table_ddl_text.get("1.0", tk.END).strip()
        where_clause = self.sql_table_filter_entry.get().strip()
        row_version_field = self.sql_table_row_version_entry.get().strip()

        if not ddl_text:
            self._set_sql_table_result("DDL is empty.")
            return
        if not where_clause:
            self._set_sql_table_result("Filter is empty. Expected: WHERE ...")
            return
        if not where_clause.lower().startswith("where "):
            self._set_sql_table_result("Filter should start with WHERE.")
            return
        if not row_version_field:
            self._set_sql_table_result("Field for row_version is empty.")
            return

        table_name = self._extract_table_name_from_ddl(ddl_text)
        if not table_name:
            self._set_sql_table_result("Could not detect table name in DDL.")
            return

        fields = self._extract_fields_from_ddl(ddl_text)
        if not fields:
            self._set_sql_table_result("Could not detect fields in DDL.")
            return

        format_vertical = bool(self.sql_table_format_vertical_var.get())
        queries = []
        queries.append("-- 1) Total rows and max row_version")
        queries.append(self._build_total_and_max_query(table_name, row_version_field, where_clause))
        queries.append("")
        queries.append("-- 2) Counts per field with percentage from total")
        queries.append(
            self._build_field_counts_query(
                table_name,
                fields,
                where_clause,
                format_vertical
            )
        )

        template_queries = self._build_template_queries(
            table_name,
            fields,
            row_version_field,
            where_clause,
            format_vertical
        )
        if template_queries:
            queries.append("")
            queries.append("-- 3) Template-based queries")
            queries.extend(template_queries)

        self._set_sql_table_result("\n".join(queries))

    def _set_sql_table_result(self, text):
        self.sql_table_result_text.config(state=tk.NORMAL)
        self.sql_table_result_text.delete("1.0", tk.END)
        self.sql_table_result_text.insert(tk.END, text)
        self.sql_table_result_text.config(state=tk.DISABLED)

    def _extract_table_name_from_ddl(self, ddl_text):
        lowered = ddl_text.lower()
        create_index = lowered.find("create table")
        if create_index == -1:
            return ""
        after_create = ddl_text[create_index:]
        tokens = after_create.split()
        if len(tokens) < 3:
            return ""
        table_token_index = 2
        if tokens[2].lower() == "if":
            table_token_index = 5 if len(tokens) > 5 else -1
        if table_token_index == -1 or table_token_index >= len(tokens):
            return ""
        return tokens[table_token_index].strip('`"')

    def _extract_fields_from_ddl(self, ddl_text):
        open_index = ddl_text.find("(")
        if open_index == -1:
            return []
        close_index = self._find_matching_paren(ddl_text, open_index)
        if close_index == -1:
            return []

        columns_block = ddl_text[open_index + 1:close_index]
        parts = self._split_columns_block(columns_block)
        skip_tokens = {
            "PRIMARY", "INDEX", "CONSTRAINT", "KEY",
            "ORDER", "PARTITION", "SETTINGS",
            "TTL", "UNIQUE", "PROJECTION"
        }

        fields = []
        for part in parts:
            cleaned = part.strip()
            if not cleaned:
                continue
            first_token = cleaned.split()[0]
            token_clean = first_token.strip('`"')
            if token_clean.upper() in skip_tokens:
                continue
            fields.append(token_clean)
        return fields

    def _find_matching_paren(self, text, open_index):
        depth = 0
        for idx in range(open_index, len(text)):
            char = text[idx]
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    return idx
        return -1

    def _split_columns_block(self, columns_block):
        parts = []
        current = []
        depth = 0
        for char in columns_block:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            if char == "," and depth == 0:
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
            else:
                current.append(char)
        last_part = "".join(current).strip()
        if last_part:
            parts.append(last_part)
        return parts

    def _build_field_counts_query(self, table_name, fields, where_clause, format_vertical):
        lines = ["SELECT", "    count() AS total_rows"]
        for field in fields:
            lines.append(f"  , count({field}) AS cnt_{field}")
            lines.append(
                f"  , round(100.0 * count({field}) / nullif(count(), 0), 2) AS pct_{field}"
            )
        lines.append(f"FROM {table_name}")
        lines.append(where_clause)
        if format_vertical:
            lines.append("FORMAT Vertical")
        lines.append(";")
        return "\n".join(lines)

    def _build_total_and_max_query(self, table_name, row_version_field, where_clause):
        lines = [
            "SELECT",
            "    count() AS total_rows",
            f"  , max({row_version_field}) AS max_{row_version_field}",
            f"FROM {table_name}",
            where_clause,
            ";"
        ]
        return "\n".join(lines)

    def _build_template_queries(self, table_name, fields, row_version_field, where_clause, format_vertical):
        templates = self.sql_table_analyzer_templates or []
        if not templates:
            return []

        queries = []
        for template in templates:
            template = template.strip()
            if not template:
                continue
            selected_fields = [field for field in fields if field != row_version_field]
            if not selected_fields:
                continue
            expressions = []
            for field in selected_fields:
                expression = template.replace(
                    "<field_for_row_version>",
                    row_version_field
                ).replace(
                    "<field>",
                    field
                )
                expression = expression.lstrip(",").strip()
                expressions.append(expression)
            queries.append(f"-- Template: {template}")
            queries.append("SELECT")
            for index, expression in enumerate(expressions):
                prefix = "    " if index == 0 else "  , "
                queries.append(f"{prefix}{expression}")
            queries.append(f"FROM {table_name}")
            queries.append(where_clause)
            if format_vertical:
                queries.append("FORMAT Vertical")
            queries.append(";")
            queries.append("")
        if queries and not queries[-1].strip():
            queries.pop()
        return queries

    def _schedule_destroy_window(self, event=None):
        if self.root:
            self.root.after(0, self.destroy_window)

    def destroy_window(self, event=None):
        if self.window:
            self.window.destroy()
            self.window = None

if __name__ == "__main__":
    app = KeyboardHelper()
    app.root.mainloop() 