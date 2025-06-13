import os
import pyperclip
import tkinter as tk
from tkinter import ttk
from pynput import keyboard
from threading import Timer
from database import Database

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
        
        # Left side
        left_frame = ttk.Frame(self.window)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.inputter = ttk.Entry(left_frame)
        self.inputter.pack(fill=tk.X, pady=(0, 5))
        self.inputter.bind('<KeyRelease>', self.filter_items)

        self.selector = tk.Listbox(left_frame, height=10)
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
        right_frame = ttk.Frame(self.window)
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
            widget.bind('<Tab>', lambda e, next_idx=(i + 1) % len(widget_order): 
                widget_order[next_idx].focus_set())
        
        # Set initial focus
        self.inputter.focus_set()
        
        # Load initial data
        self.filter_items()

    def destroy_window(self, event=None):
        if self.window:
            self.window.destroy()
            self.window = None

if __name__ == "__main__":
    app = KeyboardHelper()
    app.root.mainloop() 