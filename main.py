import os
import faulthandler
import getpass
import platform
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
import pyperclip
import tkinter as tk
from tkinter import ttk, filedialog, simpledialog, messagebox
import json
from itertools import product
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

        # App settings
        self.app_computer_id = self.superset_computer_id
        self.app_settings = self.db.get_all_app_settings(self.app_computer_id)
        self.settings_window = None
        
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
        window_width = int(self.app_settings.get('window_width', '600'))
        self.window.geometry(f"{window_width}x600")
        
        # macOS specific window settings
        self.window.lift()
        self.window.attributes('-topmost', True)
        
        # Ensure window appears on the active Space in macOS
        self.window.update_idletasks()

        # Settings button frame (above tabs)
        top_frame = ttk.Frame(self.window)
        top_frame.pack(fill=tk.X, padx=5, pady=5)
        settings_btn = ttk.Button(top_frame, text="Settings", command=self._open_settings_window)
        settings_btn.pack(side=tk.RIGHT)

        # Notebook (tabs)
        self.notebook = ttk.Notebook(self.window)
        self.notebook.pack(fill=tk.BOTH, expand=True)

        # --- Tab 1: Snippets ---
        snippets_frame = ttk.Frame(self.notebook)
        self.notebook.add(snippets_frame, text="Snippets")
        self._build_snippets_tab(snippets_frame)

        # --- Tab 2: SQL (with nested tabs) ---
        sql_main_frame = ttk.Frame(self.notebook)
        self.notebook.add(sql_main_frame, text="SQL")

        self.sql_notebook = ttk.Notebook(sql_main_frame)
        self.sql_notebook.pack(fill="both", expand=True)

        sql_parser_frame = ttk.Frame(self.sql_notebook)
        self.sql_notebook.add(sql_parser_frame, text="Parser")
        self._build_sql_tab(sql_parser_frame)

        sql_analyzer_frame = ttk.Frame(self.sql_notebook)
        self.sql_notebook.add(sql_analyzer_frame, text="Table Analyzer")
        self._build_sql_table_analyzer_tab(sql_analyzer_frame)

        sql_macrosing_frame = ttk.Frame(self.sql_notebook)
        self.sql_notebook.add(sql_macrosing_frame, text="Macrosing")
        self._build_sql_macrosing_tab(sql_macrosing_frame)

        # --- Tab 4: Superset ---
        superset_frame = ttk.Frame(self.notebook)
        self.notebook.add(superset_frame, text="Superset")
        self._build_superset_tab(superset_frame)

        # --- Tab 5: Commits ---
        commits_frame = ttk.Frame(self.notebook)
        self.notebook.add(commits_frame, text="Commits")
        self._build_commits_tab(commits_frame)

        # Ctrl+Tab and Ctrl+Shift+Tab to switch tabs (универсально для всех виджетов)
        self._bind_ctrl_tab_to_all(self.window)

        # Apply saved settings
        self._apply_snippets_settings()

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
        self.snippets_left_frame = left_frame

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
        self.sql_table_analyze_btn.pack(side=tk.LEFT, fill=tk.X, expand=True)

        result_label = ttk.Label(parent, text="Result:")
        result_label.pack(anchor=tk.W, padx=10, pady=(0, 2))
        self.sql_table_result_text = tk.Text(parent, name="sql_table_result_text")
        self.sql_table_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.sql_table_result_text.config(state=tk.DISABLED)

        self.sql_table_settings_window = None
        format_vertical_value = self.app_settings.get('sql_analyzer_format_vertical', '1') == '1'
        self.sql_table_format_vertical_var = tk.BooleanVar(value=format_vertical_value)

    def _build_sql_macrosing_tab(self, parent):
        # Templates row
        templates_frame = ttk.Frame(parent)
        templates_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        ttk.Label(templates_frame, text="Templates:").pack(side=tk.LEFT)
        self.macrosing_template_combo = ttk.Combobox(templates_frame, width=30)
        self.macrosing_template_combo.pack(side=tk.LEFT, padx=(5, 5))
        self.macrosing_template_combo.bind("<<ComboboxSelected>>", self._on_macrosing_template_selected)

        ttk.Button(templates_frame, text="Save", command=self._on_save_macrosing_template).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(templates_frame, text="Delete", command=self._on_delete_macrosing_template).pack(side=tk.LEFT)

        # SQL Template
        sql_label = ttk.Label(parent, text="SQL Template:")
        sql_label.pack(anchor=tk.W, padx=10, pady=(5, 2))
        self.macrosing_sql_text = tk.Text(parent, height=6)
        self.macrosing_sql_text.pack(fill=tk.X, padx=10, pady=(0, 5))
        self.macrosing_sql_text.bind("<KeyRelease>", self._on_macrosing_sql_change)

        # Placeholders frame with header
        placeholders_header = ttk.Frame(parent)
        placeholders_header.pack(fill=tk.X, padx=10, pady=(5, 2))
        ttk.Label(placeholders_header, text="Placeholders:").pack(side=tk.LEFT)
        ttk.Button(placeholders_header, text="Refresh from SQL", command=self._refresh_macrosing_placeholders).pack(side=tk.RIGHT)

        # Scrollable frame for placeholders
        placeholders_container = ttk.Frame(parent)
        placeholders_container.pack(fill=tk.BOTH, expand=False, padx=10, pady=(0, 5))

        placeholders_canvas = tk.Canvas(placeholders_container, height=150)
        placeholders_scrollbar = ttk.Scrollbar(placeholders_container, orient="vertical", command=placeholders_canvas.yview)
        self.macrosing_placeholders_frame = ttk.Frame(placeholders_canvas)

        self.macrosing_placeholders_frame.bind(
            "<Configure>",
            lambda e: placeholders_canvas.configure(scrollregion=placeholders_canvas.bbox("all"))
        )
        placeholders_canvas.create_window((0, 0), window=self.macrosing_placeholders_frame, anchor="nw")
        placeholders_canvas.configure(yscrollcommand=placeholders_scrollbar.set)

        placeholders_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        placeholders_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Combination mode and separator
        options_frame = ttk.Frame(parent)
        options_frame.pack(fill=tk.X, padx=10, pady=(5, 5))

        ttk.Label(options_frame, text="Combination:").pack(side=tk.LEFT)
        self.macrosing_combination_var = tk.StringVar(value="cartesian")
        ttk.Radiobutton(options_frame, text="Cartesian", variable=self.macrosing_combination_var, value="cartesian").pack(side=tk.LEFT, padx=(5, 10))
        ttk.Radiobutton(options_frame, text="Zip", variable=self.macrosing_combination_var, value="zip").pack(side=tk.LEFT, padx=(0, 20))

        ttk.Label(options_frame, text="Separator:").pack(side=tk.LEFT)
        self.macrosing_separator_entry = ttk.Entry(options_frame, width=10)
        self.macrosing_separator_entry.pack(side=tk.LEFT, padx=(5, 0))
        self.macrosing_separator_entry.insert(0, ";\\n")

        # Generate button
        ttk.Button(parent, text="Generate SQL", command=self._on_generate_macrosing).pack(fill=tk.X, padx=10, pady=(5, 5))

        # Result
        result_header = ttk.Frame(parent)
        result_header.pack(fill=tk.X, padx=10, pady=(5, 2))
        ttk.Label(result_header, text="Result:").pack(side=tk.LEFT)
        ttk.Button(result_header, text="Copy", command=self._copy_macrosing_result).pack(side=tk.RIGHT)

        self.macrosing_result_text = tk.Text(parent, height=8)
        self.macrosing_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.macrosing_result_text.config(state=tk.DISABLED)

        # Initialize
        self.macrosing_placeholder_widgets = {}
        self._refresh_macrosing_templates()

    def _refresh_macrosing_templates(self):
        templates = self.db.get_sql_macrosing_templates()
        names = [t['template_name'] for t in templates]
        self.macrosing_template_combo['values'] = names
        if names:
            self.macrosing_template_combo.set('')

    def _on_macrosing_template_selected(self, event=None):
        name = self.macrosing_template_combo.get()
        if not name:
            return
        template = self.db.get_sql_macrosing_template_by_name(name)
        if template:
            self.macrosing_sql_text.delete("1.0", "end")
            self.macrosing_sql_text.insert("1.0", template['template_text'])
            self.macrosing_combination_var.set(template['combination_mode'])
            self.macrosing_separator_entry.delete(0, "end")
            self.macrosing_separator_entry.insert(0, template['separator'])
            self._load_placeholders_config(json.loads(template['placeholders_config']))

    def _on_save_macrosing_template(self):
        name = self.macrosing_template_combo.get().strip()
        if not name:
            name = simpledialog.askstring("Save Template", "Enter template name:", parent=self.window)
            if not name:
                return

        self.db.save_sql_macrosing_template(
            name=name,
            template_text=self.macrosing_sql_text.get("1.0", "end-1c"),
            placeholders_config=json.dumps(self._collect_placeholders_config()),
            combination_mode=self.macrosing_combination_var.get(),
            separator=self.macrosing_separator_entry.get()
        )
        self._refresh_macrosing_templates()
        self.macrosing_template_combo.set(name)

    def _on_delete_macrosing_template(self):
        name = self.macrosing_template_combo.get().strip()
        if not name:
            return
        self.db.delete_sql_macrosing_template(name)
        self._refresh_macrosing_templates()
        self.macrosing_template_combo.set('')

    def _on_macrosing_sql_change(self, event=None):
        self._refresh_macrosing_placeholders()

    def _extract_placeholders(self, sql_text: str) -> list[str]:
        return list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}', sql_text)))

    def _refresh_macrosing_placeholders(self):
        sql_text = self.macrosing_sql_text.get("1.0", "end-1c")
        placeholders = self._extract_placeholders(sql_text)

        old_config = self._collect_placeholders_config()

        for widget in self.macrosing_placeholders_frame.winfo_children():
            widget.destroy()
        self.macrosing_placeholder_widgets = {}

        for ph in placeholders:
            self._create_placeholder_row(ph, old_config.get(f'{{{{{ph}}}}}', {}))

    def _create_placeholder_row(self, placeholder_name: str, config: dict = None):
        if config is None:
            config = {}

        frame = ttk.Frame(self.macrosing_placeholders_frame)
        frame.pack(fill=tk.X, pady=2)

        ttk.Label(frame, text=f"{{{{{placeholder_name}}}}}:", width=15).pack(side=tk.LEFT)

        type_var = tk.StringVar(value=config.get('type', 'static'))
        type_combo = ttk.Combobox(frame, textvariable=type_var, values=['static', 'sequence', 'date'], width=10, state="readonly")
        type_combo.pack(side=tk.LEFT, padx=(5, 5))

        fields_frame = ttk.Frame(frame)
        fields_frame.pack(side=tk.LEFT, fill=tk.X, expand=True)

        widgets = {
            'type_var': type_var,
            'fields_frame': fields_frame,
            'config': config
        }
        self.macrosing_placeholder_widgets[placeholder_name] = widgets

        type_combo.bind("<<ComboboxSelected>>", lambda e, ph=placeholder_name: self._on_placeholder_type_change(ph))
        self._build_placeholder_fields(placeholder_name)

    def _on_placeholder_type_change(self, placeholder_name: str):
        self._build_placeholder_fields(placeholder_name)

    def _build_placeholder_fields(self, placeholder_name: str):
        widgets = self.macrosing_placeholder_widgets[placeholder_name]
        fields_frame = widgets['fields_frame']
        type_val = widgets['type_var'].get()
        config = widgets.get('config', {})

        for child in fields_frame.winfo_children():
            child.destroy()

        if type_val == 'static':
            ttk.Label(fields_frame, text="Values:").pack(side=tk.LEFT)
            values_entry = ttk.Entry(fields_frame, width=30)
            values_entry.pack(side=tk.LEFT, padx=(5, 0), fill=tk.X, expand=True)
            values_entry.insert(0, config.get('values', ''))
            widgets['values_entry'] = values_entry

        elif type_val == 'sequence':
            ttk.Label(fields_frame, text="Start:").pack(side=tk.LEFT)
            start_entry = ttk.Entry(fields_frame, width=8)
            start_entry.pack(side=tk.LEFT, padx=(2, 5))
            start_entry.insert(0, str(config.get('start', '1')))

            ttk.Label(fields_frame, text="End:").pack(side=tk.LEFT)
            end_entry = ttk.Entry(fields_frame, width=8)
            end_entry.pack(side=tk.LEFT, padx=(2, 5))
            end_entry.insert(0, str(config.get('end', '10')))

            ttk.Label(fields_frame, text="Step:").pack(side=tk.LEFT)
            step_entry = ttk.Entry(fields_frame, width=5)
            step_entry.pack(side=tk.LEFT, padx=(2, 0))
            step_entry.insert(0, str(config.get('step', '1')))

            widgets['start_entry'] = start_entry
            widgets['end_entry'] = end_entry
            widgets['step_entry'] = step_entry

        elif type_val == 'date':
            ttk.Label(fields_frame, text="Start:").pack(side=tk.LEFT)
            start_entry = ttk.Entry(fields_frame, width=10)
            start_entry.pack(side=tk.LEFT, padx=(2, 5))
            start_entry.insert(0, config.get('start', '2024-01-01'))

            ttk.Label(fields_frame, text="End:").pack(side=tk.LEFT)
            end_entry = ttk.Entry(fields_frame, width=10)
            end_entry.pack(side=tk.LEFT, padx=(2, 5))
            end_entry.insert(0, config.get('end', '2024-12-01'))

            ttk.Label(fields_frame, text="Step:").pack(side=tk.LEFT)
            step_var = tk.StringVar(value=config.get('step', 'month'))
            step_combo = ttk.Combobox(fields_frame, textvariable=step_var, values=['days', 'weeks', 'month', 'half_year', 'year'], width=8, state="readonly")
            step_combo.pack(side=tk.LEFT, padx=(2, 5))

            ttk.Label(fields_frame, text="Format:").pack(side=tk.LEFT)
            format_var = tk.StringVar(value=config.get('format', 'ISO'))
            format_combo = ttk.Combobox(fields_frame, textvariable=format_var, values=['ISO', 'YYYYMM'], width=8, state="readonly")
            format_combo.pack(side=tk.LEFT, padx=(2, 0))

            widgets['start_entry'] = start_entry
            widgets['end_entry'] = end_entry
            widgets['step_var'] = step_var
            widgets['format_var'] = format_var

    def _collect_placeholders_config(self) -> dict:
        config = {}
        for ph_name, widgets in self.macrosing_placeholder_widgets.items():
            ph_key = f'{{{{{ph_name}}}}}'
            type_val = widgets['type_var'].get()
            ph_config = {'type': type_val}

            if type_val == 'static':
                ph_config['values'] = widgets.get('values_entry', ttk.Entry()).get()
            elif type_val == 'sequence':
                ph_config['start'] = widgets.get('start_entry', ttk.Entry()).get()
                ph_config['end'] = widgets.get('end_entry', ttk.Entry()).get()
                ph_config['step'] = widgets.get('step_entry', ttk.Entry()).get()
            elif type_val == 'date':
                ph_config['start'] = widgets.get('start_entry', ttk.Entry()).get()
                ph_config['end'] = widgets.get('end_entry', ttk.Entry()).get()
                ph_config['step'] = widgets.get('step_var', tk.StringVar()).get()
                ph_config['format'] = widgets.get('format_var', tk.StringVar()).get()

            config[ph_key] = ph_config
        return config

    def _load_placeholders_config(self, config: dict):
        for widget in self.macrosing_placeholders_frame.winfo_children():
            widget.destroy()
        self.macrosing_placeholder_widgets = {}

        for ph_key, ph_config in config.items():
            ph_name = ph_key.strip('{}')
            self._create_placeholder_row(ph_name, ph_config)

    def _generate_values(self, config: dict) -> list:
        type_val = config.get('type', 'static')

        if type_val == 'static':
            values_str = config.get('values', '')
            values_str = values_str.strip().strip('[]')
            if not values_str:
                return []
            values = [v.strip() for v in values_str.split(',')]
            return [v for v in values if v]

        elif type_val == 'sequence':
            try:
                start = int(config.get('start', 1))
                end = int(config.get('end', 10))
                step = int(config.get('step', 1))
                if step == 0:
                    step = 1
                return list(range(start, end + 1, step))
            except ValueError:
                return []

        elif type_val == 'date':
            try:
                start_str = config.get('start', '2024-01-01')
                end_str = config.get('end', '2024-12-01')
                step = config.get('step', 'month')
                date_format = config.get('format', 'ISO')

                start_date = datetime.strptime(start_str, '%Y-%m-%d')
                end_date = datetime.strptime(end_str, '%Y-%m-%d')

                dates = []
                current = start_date
                while current <= end_date:
                    if date_format == 'ISO':
                        dates.append(current.strftime('%Y-%m-%d'))
                    else:  # YYYYMM
                        dates.append(current.strftime('%Y%m'))

                    if step == 'days':
                        current += timedelta(days=1)
                    elif step == 'weeks':
                        current += timedelta(weeks=1)
                    elif step == 'month':
                        current = self._add_months(current, 1)
                    elif step == 'half_year':
                        current = self._add_months(current, 6)
                    elif step == 'year':
                        current = self._add_months(current, 12)
                    else:
                        current = self._add_months(current, 1)

                return dates
            except (ValueError, TypeError):
                return []

        return []

    def _add_months(self, dt: datetime, months: int) -> datetime:
        month = dt.month - 1 + months
        year = dt.year + month // 12
        month = month % 12 + 1
        day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                          31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return dt.replace(year=year, month=month, day=day)

    def _combine_values(self, placeholders_values: dict, mode: str) -> list[dict]:
        if not placeholders_values:
            return [{}]

        keys = list(placeholders_values.keys())
        values = [placeholders_values[k] for k in keys]

        if mode == 'cartesian':
            return [dict(zip(keys, combo)) for combo in product(*values)]
        else:  # zip
            return [dict(zip(keys, combo)) for combo in zip(*values)]

    def _on_generate_macrosing(self):
        sql_template = self.macrosing_sql_text.get("1.0", "end-1c")
        separator = self.macrosing_separator_entry.get()
        mode = self.macrosing_combination_var.get()

        placeholders_config = self._collect_placeholders_config()
        sql_placeholders = self._extract_placeholders(sql_template)

        for ph in sql_placeholders:
            ph_key = f'{{{{{ph}}}}}'
            if ph_key not in placeholders_config:
                messagebox.showerror("Error", f"Placeholder {ph_key} is not configured", parent=self.window)
                return

        placeholders_values = {}
        for name, config in placeholders_config.items():
            values = self._generate_values(config)
            if not values:
                messagebox.showerror("Error", f"No values generated for {name}", parent=self.window)
                return
            placeholders_values[name] = values

        combinations = self._combine_values(placeholders_values, mode)

        queries = []
        for combo in combinations:
            query = sql_template
            for placeholder, value in combo.items():
                query = query.replace(placeholder, str(value))
            queries.append(query)

        try:
            decoded_separator = separator.encode().decode('unicode_escape')
        except Exception:
            decoded_separator = separator

        result = decoded_separator.join(queries)
        self._set_macrosing_result(result)

    def _set_macrosing_result(self, text):
        self.macrosing_result_text.config(state=tk.NORMAL)
        self.macrosing_result_text.delete("1.0", tk.END)
        self.macrosing_result_text.insert(tk.END, text)
        self.macrosing_result_text.config(state=tk.DISABLED)

    def _copy_macrosing_result(self):
        self.macrosing_result_text.config(state=tk.NORMAL)
        result = self.macrosing_result_text.get("1.0", "end-1c")
        self.macrosing_result_text.config(state=tk.DISABLED)
        if result:
            pyperclip.copy(result)

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

    # --- Commits Tab ---
    COMMIT_OBJECT_HINTS = {
        "отчет": "004.1",
        "таблица": "datamart.srid_tracker_tangle",
        "плагин": "имя функции",
        "даг": "dm3_report_1",
        "ручка апи": "/api/v1/endpoint",
        "несколько": "общий префикс или пусто"
    }

    COMMIT_TYPES = ["fix", "new", "rm", "feat", "ref", "chore", "style"]
    COMMIT_CATEGORIES = ["отчет", "таблица", "плагин", "даг", "ручка апи", "несколько"]

    def _build_commits_tab(self, parent):
        # Initialize default tags
        self.db.init_default_commit_tags(self.app_computer_id)

        # Main scrollable canvas
        canvas = tk.Canvas(parent)
        scrollbar = ttk.Scrollbar(parent, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # --- Block: Данные задачи ---
        task_frame = ttk.LabelFrame(scrollable_frame, text="Данные задачи")
        task_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        task_link_row = ttk.Frame(task_frame)
        task_link_row.pack(fill=tk.X, padx=5, pady=(5, 2))
        ttk.Label(task_link_row, text="Task Link:").pack(side=tk.LEFT)
        self.commits_task_link_entry = ttk.Entry(task_link_row)
        self.commits_task_link_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_task_link_entry.bind("<KeyRelease>", self._on_commits_task_link_change)

        task_id_row = ttk.Frame(task_frame)
        task_id_row.pack(fill=tk.X, padx=5, pady=(2, 5))
        ttk.Label(task_id_row, text="Task ID:").pack(side=tk.LEFT)
        self.commits_task_id_entry = ttk.Entry(task_id_row, state="readonly")
        self.commits_task_id_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))

        # --- Block: Объект ---
        object_frame = ttk.LabelFrame(scrollable_frame, text="Объект")
        object_frame.pack(fill=tk.X, padx=10, pady=5)

        type_row = ttk.Frame(object_frame)
        type_row.pack(fill=tk.X, padx=5, pady=(5, 2))
        ttk.Label(type_row, text="Type:").pack(side=tk.LEFT)
        self.commits_type_combo = ttk.Combobox(type_row, values=self.COMMIT_TYPES, state="readonly", width=10)
        self.commits_type_combo.pack(side=tk.LEFT, padx=(5, 0))
        self.commits_type_combo.set("fix")
        self.commits_type_combo.bind("<<ComboboxSelected>>", self._update_commits_preview)

        category_row = ttk.Frame(object_frame)
        category_row.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(category_row, text="Object category:").pack(side=tk.LEFT)
        self.commits_category_combo = ttk.Combobox(category_row, values=self.COMMIT_CATEGORIES, state="readonly", width=15)
        self.commits_category_combo.pack(side=tk.LEFT, padx=(5, 0))
        self.commits_category_combo.set("отчет")
        self.commits_category_combo.bind("<<ComboboxSelected>>", self._on_commits_category_change)

        # Conditional fields container
        self.commits_conditional_frame = ttk.Frame(object_frame)
        self.commits_conditional_frame.pack(fill=tk.X, padx=5, pady=2)

        # Test report field (conditional)
        self.commits_test_report_frame = ttk.Frame(self.commits_conditional_frame)
        test_report_row = ttk.Frame(self.commits_test_report_frame)
        test_report_row.pack(fill=tk.X, pady=2)
        ttk.Label(test_report_row, text="Тестовый отчет:").pack(side=tk.LEFT)
        self.commits_test_report_entry = ttk.Entry(test_report_row)
        self.commits_test_report_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_test_report_entry.bind("<KeyRelease>", self._on_commits_test_report_change)

        # Prod report field (conditional)
        self.commits_prod_report_frame = ttk.Frame(self.commits_conditional_frame)
        prod_report_row = ttk.Frame(self.commits_prod_report_frame)
        prod_report_row.pack(fill=tk.X, pady=2)
        ttk.Label(prod_report_row, text="Продовый отчет:").pack(side=tk.LEFT)
        self.commits_prod_report_entry = ttk.Entry(prod_report_row)
        self.commits_prod_report_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_prod_report_entry.bind("<KeyRelease>", self._update_commits_chat_preview)

        # Transfer connect field (conditional, for "отчет")
        self.commits_transfer_connect_frame = ttk.Frame(self.commits_conditional_frame)
        transfer_connect_row = ttk.Frame(self.commits_transfer_connect_frame)
        transfer_connect_row.pack(fill=tk.X, pady=2)
        ttk.Label(transfer_connect_row, text="Перенести коннект:").pack(side=tk.LEFT)
        self.commits_transfer_connect_entry = ttk.Entry(transfer_connect_row)
        self.commits_transfer_connect_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_transfer_connect_entry.bind("<KeyRelease>", self._update_commits_chat_preview)

        # Test dag field (conditional)
        self.commits_test_dag_frame = ttk.Frame(self.commits_conditional_frame)
        test_dag_row = ttk.Frame(self.commits_test_dag_frame)
        test_dag_row.pack(fill=tk.X, pady=2)
        ttk.Label(test_dag_row, text="Тестовый даг:").pack(side=tk.LEFT)
        self.commits_test_dag_entry = ttk.Entry(test_dag_row)
        self.commits_test_dag_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_test_dag_entry.bind("<KeyRelease>", self._update_commits_chat_preview)

        # Object hint and entry
        hint_row = ttk.Frame(object_frame)
        hint_row.pack(fill=tk.X, padx=5, pady=(5, 2))
        self.commits_object_hint_label = ttk.Label(hint_row, text='Пример: "004.1"', foreground="gray")
        self.commits_object_hint_label.pack(anchor=tk.W)

        object_row = ttk.Frame(object_frame)
        object_row.pack(fill=tk.X, padx=5, pady=(0, 5))
        ttk.Label(object_row, text="Object:").pack(side=tk.LEFT)
        self.commits_object_entry = ttk.Entry(object_row)
        self.commits_object_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_object_entry.bind("<KeyRelease>", self._update_commits_preview)

        # --- Block: Формирование коммита ---
        commit_frame = ttk.LabelFrame(scrollable_frame, text="Формирование коммита")
        commit_frame.pack(fill=tk.X, padx=10, pady=5)

        message_row = ttk.Frame(commit_frame)
        message_row.pack(fill=tk.X, padx=5, pady=(5, 2))
        ttk.Label(message_row, text="Message:").pack(side=tk.LEFT)
        self.commits_message_entry = ttk.Entry(message_row)
        self.commits_message_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_message_entry.bind("<KeyRelease>", self._update_commits_preview)

        result_row = ttk.Frame(commit_frame)
        result_row.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(result_row, text="Результат:").pack(side=tk.LEFT)
        self.commits_result_entry = ttk.Entry(result_row, state="readonly")
        self.commits_result_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))

        copy_commit_btn = ttk.Button(commit_frame, text="Копировать коммит", command=self._copy_commit_string)
        copy_commit_btn.pack(fill=tk.X, padx=5, pady=(2, 5))

        # --- Block: Сообщение в чат ---
        chat_frame = ttk.LabelFrame(scrollable_frame, text="Сообщение в чат")
        chat_frame.pack(fill=tk.X, padx=10, pady=5)

        # Tags selection
        tags_row = ttk.Frame(chat_frame)
        tags_row.pack(fill=tk.X, padx=5, pady=(5, 2))
        ttk.Label(tags_row, text="Теги:").pack(side=tk.LEFT)
        self.commits_tags_combo = ttk.Combobox(tags_row, state="readonly", width=25)
        self.commits_tags_combo.pack(side=tk.LEFT, padx=(5, 5))
        add_tag_btn = ttk.Button(tags_row, text="+ Добавить", command=self._on_commits_add_selected_tag)
        add_tag_btn.pack(side=tk.LEFT)

        # Selected tags entry (readonly)
        selected_tags_row = ttk.Frame(chat_frame)
        selected_tags_row.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(selected_tags_row, text="Выбранные теги:").pack(side=tk.LEFT)
        self.commits_selected_tags_entry = ttk.Entry(selected_tags_row, state="readonly")
        self.commits_selected_tags_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 5))
        ttk.Button(selected_tags_row, text="Очистить", command=self._on_commits_clear_tags).pack(side=tk.LEFT)

        # MR field
        mr_row = ttk.Frame(chat_frame)
        mr_row.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(mr_row, text="MR:").pack(side=tk.LEFT)
        self.commits_mr_entry = ttk.Entry(mr_row)
        self.commits_mr_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 0))
        self.commits_mr_entry.bind("<KeyRelease>", self._update_commits_chat_preview)

        # Chat preview
        preview_label = ttk.Label(chat_frame, text="Превью сообщения:")
        preview_label.pack(anchor=tk.W, padx=5, pady=(5, 2))
        self.commits_chat_preview = tk.Text(chat_frame, height=6)
        self.commits_chat_preview.pack(fill=tk.X, padx=5, pady=(0, 2))

        copy_chat_btn = ttk.Button(chat_frame, text="Копировать сообщение", command=self._copy_chat_message)
        copy_chat_btn.pack(fill=tk.X, padx=5, pady=(2, 5))

        # Initialize UI state
        self._load_commits_tags()
        self._on_commits_category_change()

    def _set_readonly_entry(self, entry, value):
        """Set value in a readonly entry widget."""
        entry.config(state="normal")
        entry.delete(0, tk.END)
        entry.insert(0, value)
        entry.config(state="readonly")

    def _on_commits_task_link_change(self, event=None):
        """Parse task link and extract task ID."""
        link = self.commits_task_link_entry.get().strip()
        task_id = ""
        # Pattern: https://sssss.ru/issue/DataOps-3326/... or DTO-123
        match = re.search(r'/issue/([A-Za-z]+-\d+)', link, re.IGNORECASE)
        if match:
            task_id = match.group(1)
        else:
            # Try to match standalone task ID like DTO-123
            match = re.search(r'\b([A-Za-z]+-\d+)\b', link, re.IGNORECASE)
            if match:
                task_id = match.group(1)
        self._set_readonly_entry(self.commits_task_id_entry, task_id)
        self._update_commits_preview()
        self._update_commits_chat_preview()

    def _on_commits_category_change(self, event=None):
        """Handle category change - update hint and show/hide conditional fields."""
        category = self.commits_category_combo.get()

        # Update hint
        hint = self.COMMIT_OBJECT_HINTS.get(category, "")
        self.commits_object_hint_label.config(text=f'Пример: "{hint}"')

        # Hide all conditional fields
        self.commits_test_report_frame.pack_forget()
        self.commits_prod_report_frame.pack_forget()
        self.commits_transfer_connect_frame.pack_forget()
        self.commits_test_dag_frame.pack_forget()

        # Show relevant fields
        if category == "отчет":
            self.commits_test_report_frame.pack(fill=tk.X)
            self.commits_prod_report_frame.pack(fill=tk.X)
            self.commits_transfer_connect_frame.pack(fill=tk.X)
        elif category == "даг":
            self.commits_test_dag_frame.pack(fill=tk.X)

        self._update_commits_chat_preview()

    def _on_commits_test_report_change(self, event=None):
        """Auto-fill prod report URL from test report URL."""
        test_url = self.commits_test_report_entry.get().strip()
        prod_url = test_url.replace("superset-test", "superset")
        self.commits_prod_report_entry.delete(0, tk.END)
        self.commits_prod_report_entry.insert(0, prod_url)
        self._update_commits_chat_preview()

    def _update_commits_preview(self, event=None):
        """Update commit string preview."""
        task_id = self.commits_task_id_entry.get().strip()
        type_ = self.commits_type_combo.get()
        obj = self.commits_object_entry.get().strip()
        msg = self.commits_message_entry.get().strip()

        # Format: [task] type(object): message
        result = ""
        if task_id:
            result += f"[{task_id}] "
        if obj:
            result += f"{type_}({obj})"
        else:
            result += type_
        if msg:
            result += f": {msg}"

        self._set_readonly_entry(self.commits_result_entry, result)

    def _update_commits_chat_preview(self, event=None):
        """Update chat message preview."""
        tags_str = self.commits_selected_tags_entry.get().strip()
        task_id = self.commits_task_id_entry.get().strip()
        task_link = self.commits_task_link_entry.get().strip()
        category = self.commits_category_combo.get()
        mr_link = self.commits_mr_entry.get().strip()

        lines = []
        # 1. Tags
        if tags_str:
            lines.append(tags_str)
        # 2. Task link
        if task_id and task_link:
            lines.append(f"[{task_id}]({task_link})")
        elif task_id:
            lines.append(task_id)
        # 3. MR
        if mr_link:
            lines.append(f"MR: {mr_link}")
        # 4. Dag (if category = dag)
        if category == "даг":
            test_dag = self.commits_test_dag_entry.get().strip()
            if test_dag:
                lines.append(f"даг: [тест]({test_dag})")
        # 5-6. Reports (if category = report)
        if category == "отчет":
            test_url = self.commits_test_report_entry.get().strip()
            prod_url = self.commits_prod_report_entry.get().strip()
            if test_url or prod_url:
                parts = []
                if test_url:
                    parts.append(f"[тест]({test_url})")
                if prod_url:
                    parts.append(f"[прод]({prod_url})")
                lines.append(f"отчеты: {', '.join(parts)}")
            # Transfer connect
            transfer_connect = self.commits_transfer_connect_entry.get().strip()
            if transfer_connect:
                lines.append(f"надо перенести коннект: {transfer_connect}")

        self.commits_chat_preview.delete("1.0", tk.END)
        self.commits_chat_preview.insert("1.0", "\n".join(lines))

    def _copy_commit_string(self):
        """Copy commit string to clipboard."""
        result = self.commits_result_entry.get()
        if result:
            pyperclip.copy(result)

    def _copy_chat_message(self):
        """Copy chat message to clipboard."""
        message = self.commits_chat_preview.get("1.0", tk.END).strip()
        if message:
            pyperclip.copy(message)

    def _load_commits_tags(self):
        """Load saved tags from database."""
        tags = self.db.get_commit_tags(self.app_computer_id)
        tag_names = [t['tag_name'] for t in tags]

        # Update combo
        self.commits_tags_combo['values'] = tag_names
        if tag_names:
            self.commits_tags_combo.set(tag_names[0])

    def _on_commits_add_selected_tag(self):
        """Add selected tag to the list of tags for chat message."""
        tag = self.commits_tags_combo.get()
        if tag:
            # Get current tags from entry
            current = self.commits_selected_tags_entry.get().strip()
            existing = current.split() if current else []
            if tag not in existing:
                existing.append(tag)
                self._set_readonly_entry(self.commits_selected_tags_entry, " ".join(existing))
                self._update_commits_chat_preview()

    def _on_commits_clear_tags(self):
        """Clear all selected tags."""
        self._set_readonly_entry(self.commits_selected_tags_entry, "")
        self._update_commits_chat_preview()

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

    def _open_settings_window(self):
        if self.settings_window and self.settings_window.winfo_exists():
            self.settings_window.lift()
            return

        if self.window:
            self.window.attributes('-topmost', False)
        self.settings_window = tk.Toplevel(self.window)
        self.settings_window.title("Settings")
        self.settings_window.geometry("600x450")
        self.settings_window.transient(self.window)
        self.settings_window.attributes('-topmost', True)
        self.settings_window.lift()
        self.settings_window.focus_force()
        self.settings_window.protocol("WM_DELETE_WINDOW", self._close_settings_window)

        # Notebook for settings tabs
        settings_notebook = ttk.Notebook(self.settings_window)
        settings_notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # General tab
        general_frame = ttk.Frame(settings_notebook)
        settings_notebook.add(general_frame, text="General")
        self._build_settings_general_tab(general_frame)

        # Snippets tab
        snippets_frame = ttk.Frame(settings_notebook)
        settings_notebook.add(snippets_frame, text="Snippets")
        self._build_settings_snippets_tab(snippets_frame)

        # SQL Table Analyser tab
        sql_analyzer_frame = ttk.Frame(settings_notebook)
        settings_notebook.add(sql_analyzer_frame, text="SQL Table Analyser")
        self._build_settings_sql_analyzer_tab(sql_analyzer_frame)

        # Commits tab
        commits_settings_frame = ttk.Frame(settings_notebook)
        settings_notebook.add(commits_settings_frame, text="Commits")
        self._build_settings_commits_tab(commits_settings_frame)

        # Buttons frame
        buttons_frame = ttk.Frame(self.settings_window)
        buttons_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
        cancel_btn = ttk.Button(buttons_frame, text="Cancel", command=self._close_settings_window)
        cancel_btn.pack(side=tk.RIGHT, padx=(5, 0))
        save_btn = ttk.Button(buttons_frame, text="Save", command=self._save_settings)
        save_btn.pack(side=tk.RIGHT)

    def _build_settings_general_tab(self, parent):
        # Window width setting
        window_width_frame = ttk.Frame(parent)
        window_width_frame.pack(fill=tk.X, padx=10, pady=(10, 5))
        ttk.Label(window_width_frame, text="Window width:").pack(side=tk.LEFT)
        current_width = self.app_settings.get('window_width', '600')
        self.settings_window_width_var = tk.StringVar(value=current_width)
        ttk.Spinbox(
            window_width_frame,
            from_=400,
            to=1200,
            width=5,
            textvariable=self.settings_window_width_var
        ).pack(side=tk.LEFT, padx=(10, 0))
        ttk.Label(window_width_frame, text="px").pack(side=tk.LEFT, padx=(5, 0))

    def _build_settings_snippets_tab(self, parent):
        # Font size
        font_size_frame = ttk.Frame(parent)
        font_size_frame.pack(fill=tk.X, padx=10, pady=(10, 5))
        font_size_label = ttk.Label(font_size_frame, text="Font size:")
        font_size_label.pack(side=tk.LEFT)
        current_font_size = self.app_settings.get('snippets_font_size', '12')
        self.settings_font_size_var = tk.StringVar(value=current_font_size)
        font_size_spinbox = ttk.Spinbox(
            font_size_frame,
            from_=8,
            to=24,
            width=5,
            textvariable=self.settings_font_size_var
        )
        font_size_spinbox.pack(side=tk.LEFT, padx=(10, 0))

        # Left panel width
        panel_width_frame = ttk.Frame(parent)
        panel_width_frame.pack(fill=tk.X, padx=10, pady=(5, 5))
        panel_width_label = ttk.Label(panel_width_frame, text="Left panel width:")
        panel_width_label.pack(side=tk.LEFT)
        current_panel_width = self.app_settings.get('snippets_left_panel_width', '200')
        self.settings_panel_width_var = tk.StringVar(value=current_panel_width)
        panel_width_spinbox = ttk.Spinbox(
            panel_width_frame,
            from_=150,
            to=500,
            width=5,
            textvariable=self.settings_panel_width_var
        )
        panel_width_spinbox.pack(side=tk.LEFT, padx=(10, 0))
        panel_width_px_label = ttk.Label(panel_width_frame, text="px")
        panel_width_px_label.pack(side=tk.LEFT, padx=(5, 0))

    def _build_settings_sql_analyzer_tab(self, parent):
        # Format Vertical checkbox
        current_format_vertical = self.app_settings.get('sql_analyzer_format_vertical', '1')
        self.settings_format_vertical_var = tk.BooleanVar(value=current_format_vertical == '1')
        format_vertical_check = ttk.Checkbutton(
            parent,
            text="Format Vertical",
            variable=self.settings_format_vertical_var
        )
        format_vertical_check.pack(anchor=tk.W, padx=10, pady=(10, 2))

        # Templates
        templates_label = ttk.Label(parent, text="Templates (one per line):")
        templates_label.pack(anchor=tk.W, padx=10, pady=(10, 2))
        self.settings_templates_text = tk.Text(parent, height=15)
        self.settings_templates_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 8))

        self.sql_table_analyzer_templates = self.db.get_sql_table_analyzer_templates()
        templates_text = "\n".join(self.sql_table_analyzer_templates)
        if templates_text:
            self.settings_templates_text.insert("1.0", templates_text)

    def _build_settings_commits_tab(self, parent):
        # Tags management
        tags_label = ttk.Label(parent, text="Управление тегами:")
        tags_label.pack(anchor=tk.W, padx=10, pady=(10, 2))

        # Listbox with tags
        self.settings_commits_tags_listbox = tk.Listbox(parent, height=6)
        self.settings_commits_tags_listbox.pack(fill=tk.X, padx=10, pady=(0, 5))

        # Load existing tags
        tags = self.db.get_commit_tags(self.app_computer_id)
        for tag in tags:
            self.settings_commits_tags_listbox.insert(tk.END, tag['tag_name'])

        # New tag entry
        new_tag_frame = ttk.Frame(parent)
        new_tag_frame.pack(fill=tk.X, padx=10, pady=(0, 5))
        ttk.Label(new_tag_frame, text="Новый тег:").pack(side=tk.LEFT)
        self.settings_commits_new_tag_entry = ttk.Entry(new_tag_frame)
        self.settings_commits_new_tag_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 5))
        ttk.Button(
            new_tag_frame,
            text="Добавить",
            command=self._on_settings_commits_add_tag
        ).pack(side=tk.LEFT)

        # Delete button
        ttk.Button(
            parent,
            text="Удалить выбранный тег",
            command=self._on_settings_commits_delete_tag
        ).pack(fill=tk.X, padx=10, pady=(0, 5))

    def _on_settings_commits_add_tag(self):
        """Add a new tag from settings window."""
        tag = self.settings_commits_new_tag_entry.get().strip()
        if tag:
            self.db.add_commit_tag(self.app_computer_id, tag)
            self.settings_commits_tags_listbox.insert(tk.END, tag)
            self.settings_commits_new_tag_entry.delete(0, tk.END)
            # Update main commits tab if it exists
            if hasattr(self, 'commits_tags_combo'):
                self._load_commits_tags()

    def _on_settings_commits_delete_tag(self):
        """Delete selected tag from settings window."""
        selection = self.settings_commits_tags_listbox.curselection()
        if selection:
            tag = self.settings_commits_tags_listbox.get(selection[0])
            self.db.delete_commit_tag(self.app_computer_id, tag)
            self.settings_commits_tags_listbox.delete(selection[0])
            # Update main commits tab if it exists
            if hasattr(self, 'commits_tags_combo'):
                self._load_commits_tags()

    def _save_settings(self):
        # Save General settings
        window_width = self.settings_window_width_var.get()
        self.db.save_app_setting(self.app_computer_id, 'window_width', window_width)
        self.app_settings['window_width'] = window_width

        # Save Snippets settings
        font_size = self.settings_font_size_var.get()
        panel_width = self.settings_panel_width_var.get()
        self.db.save_app_setting(self.app_computer_id, 'snippets_font_size', font_size)
        self.db.save_app_setting(self.app_computer_id, 'snippets_left_panel_width', panel_width)
        self.app_settings['snippets_font_size'] = font_size
        self.app_settings['snippets_left_panel_width'] = panel_width

        # Save SQL Table Analyser settings
        format_vertical = '1' if self.settings_format_vertical_var.get() else '0'
        self.db.save_app_setting(self.app_computer_id, 'sql_analyzer_format_vertical', format_vertical)
        self.app_settings['sql_analyzer_format_vertical'] = format_vertical
        self.sql_table_format_vertical_var.set(format_vertical == '1')

        templates_text = self.settings_templates_text.get("1.0", tk.END).strip()
        templates = [line.strip() for line in templates_text.splitlines() if line.strip()]
        self.db.save_sql_table_analyzer_templates(templates)
        self.sql_table_analyzer_templates = templates

        # Apply Snippets settings
        self._apply_snippets_settings()
        self._close_settings_window()

    def _apply_snippets_settings(self):
        font_size = int(self.app_settings.get('snippets_font_size', '12'))
        panel_width = int(self.app_settings.get('snippets_left_panel_width', '200'))

        # Apply font size to widgets
        font_spec = ('TkDefaultFont', font_size)
        if hasattr(self, 'inputter'):
            self.inputter.configure(font=font_spec)
        if hasattr(self, 'selector'):
            self.selector.configure(font=font_spec)
        if hasattr(self, 'shortcut_name'):
            self.shortcut_name.configure(font=font_spec)
        if hasattr(self, 'shortcut_value'):
            self.shortcut_value.configure(font=font_spec)
        if hasattr(self, 'shortcut_description'):
            self.shortcut_description.configure(font=font_spec)

        # Apply left panel width
        if hasattr(self, 'snippets_left_frame'):
            self.snippets_left_frame.configure(width=panel_width)

    def _close_settings_window(self):
        if self.settings_window and self.settings_window.winfo_exists():
            self.settings_window.destroy()
            self.settings_window = None
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