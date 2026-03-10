import tkinter as tk
from tkinter import ttk, simpledialog, messagebox, filedialog
import subprocess
import threading
import os
from pathlib import Path
from typing import Optional


class ExecTab:
    """Module for Exec tab - execute commands and scripts."""

    def __init__(self, parent, db, app_settings, hide_window_callback=None):
        self.parent = parent
        self.db = db
        self.app_settings = app_settings
        self.hide_window_callback = hide_window_callback

        # State
        self.categories_list = []
        self.commands_list = []
        self.selected_command_id = None
        self.current_process = None
        self.stop_requested = False

        # UI references
        self.tree = None
        self.name_entry = None
        self.category_combo = None
        self.description_entry = None
        self.command_text = None
        self.output_text = None
        self.run_btn = None
        self.stop_btn = None
        self.hide_after_run_var = None

        self._build_ui()
        self._load_data()

    def _build_ui(self):
        """Build the main UI layout."""
        # Top bar with category buttons
        self._build_category_buttons(self.parent)

        # Main content: left panel (tree) + right panel (editor)
        main_frame = ttk.Frame(self.parent)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self._build_left_panel(main_frame)
        self._build_right_panel(main_frame)

        # Output panel at bottom
        self._build_output_panel(self.parent)

    def _build_category_buttons(self, parent):
        """Build category management buttons."""
        btn_frame = ttk.Frame(parent)
        btn_frame.pack(fill=tk.X, padx=5, pady=5)

        ttk.Button(btn_frame, text="+ Add Category", command=self._create_category).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="Rename", command=self._rename_category).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="- Delete", command=self._delete_category).pack(side=tk.LEFT)

    def _build_left_panel(self, parent):
        """Build left panel with treeview."""
        left_frame = ttk.Frame(parent, width=250)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, padx=(0, 5))
        left_frame.pack_propagate(False)

        ttk.Label(left_frame, text="Commands:").pack(anchor=tk.W)

        # Treeview with scrollbar
        tree_frame = ttk.Frame(left_frame)
        tree_frame.pack(fill=tk.BOTH, expand=True)

        self.tree = ttk.Treeview(tree_frame, show='tree', selectmode='browse')
        tree_scrollbar = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=tree_scrollbar.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tree_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind('<<TreeviewSelect>>', self._on_tree_select)
        self.tree.bind('<Double-1>', self._on_tree_double_click)

    def _build_right_panel(self, parent):
        """Build right panel with command editor."""
        right_frame = ttk.Frame(parent)
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Name field
        name_frame = ttk.Frame(right_frame)
        name_frame.pack(fill=tk.X, pady=(0, 5))

        ttk.Label(name_frame, text="Name:").pack(side=tk.LEFT, padx=(0, 5))
        self.name_entry = ttk.Entry(name_frame, width=30)
        self.name_entry.pack(side=tk.LEFT, padx=(0, 15))

        ttk.Label(name_frame, text="Category:").pack(side=tk.LEFT, padx=(0, 5))
        self.category_combo_var = tk.StringVar()
        self.category_combo = ttk.Combobox(
            name_frame,
            textvariable=self.category_combo_var,
            state="readonly",
            width=20
        )
        self.category_combo.pack(side=tk.LEFT)

        # Description field
        desc_frame = ttk.Frame(right_frame)
        desc_frame.pack(fill=tk.X, pady=(0, 5))

        ttk.Label(desc_frame, text="Description:").pack(side=tk.LEFT, padx=(0, 5))
        self.description_entry = ttk.Entry(desc_frame, width=50)
        self.description_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # Hide after run checkbox
        self.hide_after_run_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            desc_frame,
            text="Hide after run",
            variable=self.hide_after_run_var
        ).pack(side=tk.RIGHT, padx=(10, 0))

        # Command field
        ttk.Label(right_frame, text="Command:").pack(anchor=tk.W)

        cmd_frame = ttk.Frame(right_frame)
        cmd_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))

        self.command_text = tk.Text(cmd_frame, wrap=tk.WORD, height=6)
        cmd_scrollbar = ttk.Scrollbar(cmd_frame, orient=tk.VERTICAL, command=self.command_text.yview)
        self.command_text.configure(yscrollcommand=cmd_scrollbar.set)

        self.command_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        cmd_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Action buttons
        action_frame = ttk.Frame(right_frame)
        action_frame.pack(fill=tk.X)

        ttk.Button(action_frame, text="Browse File...", command=self._browse_file).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(action_frame, text="New", command=self._create_command).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(action_frame, text="Save", command=self._save_command).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(action_frame, text="Delete", command=self._delete_command).pack(side=tk.LEFT)

    def _build_output_panel(self, parent):
        """Build output panel at bottom."""
        output_frame = ttk.LabelFrame(parent, text="Output")
        output_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Output text with scrollbar
        text_frame = ttk.Frame(output_frame)
        text_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self.output_text = tk.Text(text_frame, wrap=tk.WORD, height=8, state='disabled')
        output_scrollbar = ttk.Scrollbar(text_frame, orient=tk.VERTICAL, command=self.output_text.yview)
        self.output_text.configure(yscrollcommand=output_scrollbar.set)

        self.output_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        output_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Control buttons
        ctrl_frame = ttk.Frame(output_frame)
        ctrl_frame.pack(fill=tk.X, padx=5, pady=(0, 5))

        ttk.Button(ctrl_frame, text="Clear", command=self._clear_output).pack(side=tk.LEFT)

        self.run_btn = ttk.Button(ctrl_frame, text="Execute", command=self._execute_command)
        self.run_btn.pack(side=tk.RIGHT, padx=(5, 0))

        self.stop_btn = ttk.Button(ctrl_frame, text="Stop", command=self._stop_execution, state='disabled')
        self.stop_btn.pack(side=tk.RIGHT)

    def _load_data(self):
        """Load categories and commands from database."""
        self._load_categories()
        self._load_commands()
        self._refresh_tree()

    def _load_categories(self):
        """Load categories from database."""
        self.categories_list = self.db.get_all_exec_categories()
        self._refresh_category_combo()

    def _refresh_category_combo(self):
        """Update category combobox values."""
        category_names = [c['name'] for c in self.categories_list]
        self.category_combo['values'] = category_names
        if category_names:
            self.category_combo.current(0)

    def _load_commands(self):
        """Load commands from database."""
        self.commands_list = self.db.get_all_exec_commands()

    def _refresh_tree(self):
        """Refresh the treeview with categories and commands."""
        # Clear existing items
        for item in self.tree.get_children():
            self.tree.delete(item)

        # Add categories as parent nodes
        for category in self.categories_list:
            cat_id = f"cat_{category['id']}"
            self.tree.insert('', 'end', cat_id, text=f"  {category['name']}", open=True)

            # Add commands under this category
            for cmd in self.commands_list:
                if cmd['category_id'] == category['id']:
                    cmd_id = f"cmd_{cmd['id']}"
                    self.tree.insert(cat_id, 'end', cmd_id, text=f"    {cmd['name']}")

    def _on_tree_select(self, event=None):
        """Handle tree selection."""
        selection = self.tree.selection()
        if not selection:
            return

        item_id = selection[0]
        if item_id.startswith('cmd_'):
            cmd_id = int(item_id.replace('cmd_', ''))
            cmd = self.db.get_exec_command_by_id(cmd_id)
            if cmd:
                self.selected_command_id = cmd_id
                self._load_command_into_editor(cmd)
        else:
            # Category selected
            self.selected_command_id = None

    def _on_tree_double_click(self, event=None):
        """Handle double-click - execute command."""
        selection = self.tree.selection()
        if not selection:
            return

        item_id = selection[0]
        if item_id.startswith('cmd_'):
            self._execute_command()

    def _load_command_into_editor(self, cmd):
        """Load command data into editor fields."""
        # Name
        self.name_entry.delete(0, tk.END)
        self.name_entry.insert(0, cmd['name'])

        # Category
        for i, cat in enumerate(self.categories_list):
            if cat['id'] == cmd['category_id']:
                self.category_combo.current(i)
                break

        # Description
        self.description_entry.delete(0, tk.END)
        self.description_entry.insert(0, cmd['description'] or '')

        # Hide after run
        self.hide_after_run_var.set(cmd.get('hide_after_run', False))

        # Command
        self.command_text.delete('1.0', tk.END)
        self.command_text.insert('1.0', cmd['command'])

    def _clear_editor(self):
        """Clear editor fields."""
        self.selected_command_id = None
        self.name_entry.delete(0, tk.END)
        self.description_entry.delete(0, tk.END)
        self.command_text.delete('1.0', tk.END)
        self.hide_after_run_var.set(False)
        if self.categories_list:
            self.category_combo.current(0)

    # ==================== Category Management ====================

    def _create_category(self):
        """Create a new category."""
        name = simpledialog.askstring("New Category", "Enter category name:", parent=self.parent)
        if name and name.strip():
            self.db.create_exec_category(name.strip())
            self._load_categories()
            self._refresh_tree()

    def _rename_category(self):
        """Rename selected category."""
        selection = self.tree.selection()
        if not selection:
            messagebox.showwarning("Warning", "Please select a category to rename.", parent=self.parent)
            return

        item_id = selection[0]
        if not item_id.startswith('cat_'):
            messagebox.showwarning("Warning", "Please select a category (not a command).", parent=self.parent)
            return

        cat_id = int(item_id.replace('cat_', ''))
        category = next((c for c in self.categories_list if c['id'] == cat_id), None)
        if not category:
            return

        new_name = simpledialog.askstring(
            "Rename Category",
            "Enter new category name:",
            initialvalue=category['name'],
            parent=self.parent
        )
        if new_name and new_name.strip():
            self.db.update_exec_category(cat_id, new_name.strip())
            self._load_categories()
            self._refresh_tree()

    def _delete_category(self):
        """Delete selected category and its commands."""
        selection = self.tree.selection()
        if not selection:
            messagebox.showwarning("Warning", "Please select a category to delete.", parent=self.parent)
            return

        item_id = selection[0]
        if not item_id.startswith('cat_'):
            messagebox.showwarning("Warning", "Please select a category (not a command).", parent=self.parent)
            return

        cat_id = int(item_id.replace('cat_', ''))
        category = next((c for c in self.categories_list if c['id'] == cat_id), None)
        if not category:
            return

        if messagebox.askyesno(
            "Confirm Delete",
            f"Delete category '{category['name']}' and all its commands?",
            parent=self.parent
        ):
            self.db.delete_exec_category(cat_id)
            self._clear_editor()
            self._load_data()

    # ==================== Command Management ====================

    def _create_command(self):
        """Create a new command."""
        if not self.categories_list:
            messagebox.showwarning("Warning", "Please create a category first.", parent=self.parent)
            return

        # Get category from combobox
        category_name = self.category_combo_var.get()
        category_id = None
        for cat in self.categories_list:
            if cat['name'] == category_name:
                category_id = cat['id']
                break

        if not category_id:
            messagebox.showwarning("Warning", "Please select a category.", parent=self.parent)
            return

        name = self.name_entry.get().strip() or "New Command"
        command = self.command_text.get('1.0', tk.END).strip()
        description = self.description_entry.get().strip()
        hide_after_run = self.hide_after_run_var.get()

        if not command:
            messagebox.showwarning("Warning", "Command cannot be empty.", parent=self.parent)
            return

        new_id = self.db.create_exec_command(category_id, name, command, description, hide_after_run)
        self.selected_command_id = new_id
        self._load_commands()
        self._refresh_tree()

        # Select the new command in tree
        self.tree.selection_set(f"cmd_{new_id}")
        self.tree.see(f"cmd_{new_id}")

    def _save_command(self):
        """Save the current command."""
        if self.selected_command_id is None:
            messagebox.showwarning("Warning", "No command selected. Use 'New' to create a command.", parent=self.parent)
            return

        # Get category from combobox
        category_name = self.category_combo_var.get()
        category_id = None
        for cat in self.categories_list:
            if cat['name'] == category_name:
                category_id = cat['id']
                break

        if not category_id:
            messagebox.showwarning("Warning", "Please select a category.", parent=self.parent)
            return

        name = self.name_entry.get().strip()
        if not name:
            messagebox.showwarning("Warning", "Name cannot be empty.", parent=self.parent)
            return

        command = self.command_text.get('1.0', tk.END).strip()
        if not command:
            messagebox.showwarning("Warning", "Command cannot be empty.", parent=self.parent)
            return

        description = self.description_entry.get().strip()
        hide_after_run = self.hide_after_run_var.get()

        self.db.update_exec_command(self.selected_command_id, category_id, name, command, description, hide_after_run)
        self._load_commands()
        self._refresh_tree()

        # Re-select the command
        self.tree.selection_set(f"cmd_{self.selected_command_id}")

    def _delete_command(self):
        """Delete the selected command."""
        if self.selected_command_id is None:
            messagebox.showwarning("Warning", "No command selected.", parent=self.parent)
            return

        if messagebox.askyesno("Confirm Delete", "Delete this command?", parent=self.parent):
            self.db.delete_exec_command(self.selected_command_id)
            self._clear_editor()
            self._load_commands()
            self._refresh_tree()

    # ==================== File Selection ====================

    def _browse_file(self):
        """Open file dialog and set command."""
        file_path = filedialog.askopenfilename(
            title="Select file to execute",
            filetypes=[
                ("All files", "*.*"),
                ("Python files", "*.py"),
                ("Batch files", "*.bat"),
                ("PowerShell", "*.ps1"),
                ("Executable", "*.exe")
            ],
            parent=self.parent
        )

        if not file_path:
            return

        # Check if it's a Python file
        if file_path.lower().endswith('.py'):
            venv_python = self._detect_venv(file_path)
            command = self._build_python_command(file_path, venv_python)

            if venv_python:
                messagebox.showinfo(
                    "venv detected",
                    f"Found virtual environment:\n{os.path.dirname(os.path.dirname(venv_python))}\n\nUsing Python from venv.",
                    parent=self.parent
                )
        else:
            # For other files, just use the path
            command = f'"{file_path}"'

        # Set command in text field
        self.command_text.delete('1.0', tk.END)
        self.command_text.insert('1.0', command)

        # Set name from filename if empty
        if not self.name_entry.get().strip():
            filename = os.path.basename(file_path)
            self.name_entry.delete(0, tk.END)
            self.name_entry.insert(0, filename)

    def _detect_venv(self, file_path: str) -> Optional[str]:
        """
        Check for venv/.venv in file's folder and up to 3 levels up.
        Returns path to python executable if found.
        """
        file_dir = Path(file_path).parent

        for _ in range(4):  # current + 3 levels up
            for venv_name in ['venv', '.venv']:
                venv_path = file_dir / venv_name
                python_exe = venv_path / 'Scripts' / 'python.exe'
                if python_exe.exists():
                    return str(python_exe)

            parent = file_dir.parent
            if parent == file_dir:  # reached root
                break
            file_dir = parent

        return None

    def _build_python_command(self, file_path: str, venv_python: Optional[str]) -> str:
        """Build command to run Python file."""
        if venv_python:
            return f'"{venv_python}" "{file_path}"'
        else:
            return f'python "{file_path}"'

    # ==================== Execution ====================

    def _execute_command(self):
        """Execute the current command."""
        command = self.command_text.get('1.0', tk.END).strip()
        if not command:
            messagebox.showwarning("Warning", "No command to execute.", parent=self.parent)
            return

        self._clear_output()
        self.stop_requested = False
        self.run_btn.config(state='disabled')
        self.stop_btn.config(state='normal')

        # Determine working directory from command
        working_dir = self._extract_working_dir(command)

        thread = threading.Thread(
            target=self._run_subprocess,
            args=(command, working_dir),
            daemon=True
        )
        thread.start()

        # Hide window if option is enabled
        if self.hide_after_run_var.get() and self.hide_window_callback:
            self.hide_window_callback()

    def _extract_working_dir(self, command: str) -> Optional[str]:
        """Extract working directory from file path in command."""
        # Try to find a quoted path
        import re
        matches = re.findall(r'"([^"]+)"', command)
        for match in matches:
            if os.path.isfile(match):
                return os.path.dirname(match)

        # Try unquoted path (first token)
        parts = command.split()
        if parts:
            first = parts[0]
            if os.path.isfile(first):
                return os.path.dirname(first)

        return None

    def _run_subprocess(self, command: str, working_dir: Optional[str]):
        """Run command in subprocess (called from thread)."""
        try:
            self.current_process = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=working_dir,
                text=True,
                bufsize=1,
                encoding='utf-8',
                errors='replace'
            )

            for line in self.current_process.stdout:
                if self.stop_requested:
                    self.current_process.terminate()
                    self.parent.after(0, self._append_output, "\n[Process terminated by user]\n")
                    break
                self.parent.after(0, self._append_output, line)

            self.current_process.wait()
            exit_code = self.current_process.returncode

            if not self.stop_requested:
                self.parent.after(0, self._append_output, f"\n[Process finished with exit code {exit_code}]\n")

        except Exception as e:
            self.parent.after(0, self._append_output, f"\n[Error: {e}]\n")
        finally:
            self.current_process = None
            self.parent.after(0, self._on_execution_finished)

    def _stop_execution(self):
        """Stop the running process."""
        self.stop_requested = True
        if self.current_process:
            try:
                self.current_process.terminate()
            except Exception:
                pass

    def _on_execution_finished(self):
        """Called when execution finishes."""
        self.run_btn.config(state='normal')
        self.stop_btn.config(state='disabled')

    def _append_output(self, text: str):
        """Append text to output panel."""
        self.output_text.config(state='normal')
        self.output_text.insert(tk.END, text)
        self.output_text.see(tk.END)
        self.output_text.config(state='disabled')

    def _clear_output(self):
        """Clear output panel."""
        self.output_text.config(state='normal')
        self.output_text.delete('1.0', tk.END)
        self.output_text.config(state='disabled')
