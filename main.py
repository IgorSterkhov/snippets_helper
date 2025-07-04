import os
import pyperclip
import tkinter as tk
from tkinter import ttk
from pynput import keyboard
from threading import Timer
from database import Database
from handlers.sql_parser import parse_sql

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
                            self.destroy_window(None)
                        else:
                            self.create_window()
                    self.last_shift_press = current_time
            elif key == keyboard.Key.esc and self.window:
                self.destroy_window(None)
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

        # Ctrl+Tab and Ctrl+Shift+Tab to switch tabs (универсально для всех виджетов)
        self._bind_ctrl_tab_to_all(self.window)

        # Set initial focus
        # self.inputter.focus_set()
        self.filter_items()

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
        self.window.bind('<Escape>', self.destroy_window)
        
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
        # Parse button
        self.sql_parse_btn = ttk.Button(parent, text="Parse SQL", command=self._on_sql_parse, name="sql_parse_btn")
        self.sql_parse_btn.pack(fill=tk.X, padx=10, pady=(0, 5))
        # Result output (expand to fill all remaining space)
        self.sql_parse_result_text = tk.Text(parent, name="sql_parse_result_text")
        self.sql_parse_result_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.sql_parse_result_text.config(state=tk.DISABLED)

    def _on_sql_parse(self):
        sql_code = self.sql_code_text.get("1.0", tk.END).strip()
        result = parse_sql(sql_code)
        self.sql_parse_result_text.config(state=tk.NORMAL)
        self.sql_parse_result_text.delete("1.0", tk.END)
        self.sql_parse_result_text.insert(tk.END, result)
        self.sql_parse_result_text.config(state=tk.DISABLED)

    def destroy_window(self, event=None):
        if self.window:
            self.window.destroy()
            self.window = None

if __name__ == "__main__":
    app = KeyboardHelper()
    app.root.mainloop() 