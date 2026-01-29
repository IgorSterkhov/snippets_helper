import tkinter as tk
from tkinter import ttk, simpledialog, messagebox
import pyperclip
import markdown
from tkhtmlview import HTMLLabel


class NotesTab:
    """Independent module for Notes tab functionality."""

    def __init__(self, parent, db, app_settings):
        self.parent = parent
        self.db = db
        self.app_settings = app_settings

        # State
        self.notes_list = []
        self.folders_list = []
        self.selected_note_id = None
        self.selected_folder_id = None  # None = show all notes
        self.is_preview_mode = False
        self.sort_by = 'date'  # 'date' or 'name'

        # UI references
        self.preview_label = None
        self.content_text = None
        self.content_frame = None

        self._build_ui()
        self._load_data()

    def _build_ui(self):
        """Build the main UI layout."""
        # Top bar: search + sort
        self._build_search_sort_bar(self.parent)

        # Main content: left panel + right panel
        main_frame = ttk.Frame(self.parent)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        self._build_left_panel(main_frame)
        self._build_right_panel(main_frame)

    def _build_search_sort_bar(self, parent):
        """Build the search and sort bar."""
        top_frame = ttk.Frame(parent)
        top_frame.pack(fill=tk.X, padx=5, pady=5)

        # Search
        ttk.Label(top_frame, text="Search:").pack(side=tk.LEFT, padx=(0, 5))
        self.search_entry = ttk.Entry(top_frame, width=30)
        self.search_entry.pack(side=tk.LEFT, padx=(0, 20))
        self.search_entry.bind('<KeyRelease>', self._filter_notes)

        # Sort
        ttk.Label(top_frame, text="Sort:").pack(side=tk.LEFT, padx=(0, 5))
        self.sort_var = tk.StringVar(value="By Date")
        self.sort_combo = ttk.Combobox(
            top_frame,
            textvariable=self.sort_var,
            values=["By Date", "By Name"],
            state="readonly",
            width=10
        )
        self.sort_combo.pack(side=tk.LEFT)
        self.sort_combo.bind('<<ComboboxSelected>>', self._on_sort_change)

    def _build_left_panel(self, parent):
        """Build the left panel with folders and notes list."""
        left_frame = ttk.Frame(parent, width=200)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, padx=(0, 5))
        left_frame.pack_propagate(False)

        # Folders section
        ttk.Label(left_frame, text="Folders:").pack(anchor=tk.W)

        folders_frame = ttk.Frame(left_frame)
        folders_frame.pack(fill=tk.X, pady=(0, 5))

        self.folders_listbox = tk.Listbox(folders_frame, height=6, exportselection=False)
        self.folders_listbox.pack(fill=tk.X)
        self.folders_listbox.bind('<<ListboxSelect>>', self._on_folder_select)

        # Folder buttons
        folder_btn_frame = ttk.Frame(left_frame)
        folder_btn_frame.pack(fill=tk.X, pady=(0, 10))

        ttk.Button(folder_btn_frame, text="+Add", width=6, command=self._create_folder).pack(side=tk.LEFT, padx=(0, 2))
        ttk.Button(folder_btn_frame, text="Rename", width=7, command=self._rename_folder).pack(side=tk.LEFT, padx=(0, 2))
        ttk.Button(folder_btn_frame, text="-Del", width=5, command=self._delete_folder).pack(side=tk.LEFT)

        # Notes section
        ttk.Label(left_frame, text="Notes:").pack(anchor=tk.W)

        self.notes_listbox = tk.Listbox(left_frame, exportselection=False)
        self.notes_listbox.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        self.notes_listbox.bind('<<ListboxSelect>>', self._on_note_select)

    def _build_right_panel(self, parent):
        """Build the right panel with note editor."""
        right_frame = ttk.Frame(parent)
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Title and Folder row
        title_folder_frame = ttk.Frame(right_frame)
        title_folder_frame.pack(fill=tk.X, pady=(0, 5))

        ttk.Label(title_folder_frame, text="Title:").pack(side=tk.LEFT, padx=(0, 5))
        self.title_entry = ttk.Entry(title_folder_frame, width=25)
        self.title_entry.pack(side=tk.LEFT, padx=(0, 15))

        ttk.Label(title_folder_frame, text="Folder:").pack(side=tk.LEFT, padx=(0, 5))
        self.folder_combo_var = tk.StringVar()
        self.folder_combo = ttk.Combobox(
            title_folder_frame,
            textvariable=self.folder_combo_var,
            state="readonly",
            width=15
        )
        self.folder_combo.pack(side=tk.LEFT)

        # Edit/Preview toggle
        toggle_frame = ttk.Frame(right_frame)
        toggle_frame.pack(fill=tk.X, pady=(0, 5))

        self.edit_btn = ttk.Button(toggle_frame, text="Edit", command=self._show_editor)
        self.edit_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.preview_btn = ttk.Button(toggle_frame, text="Preview", command=self._show_preview)
        self.preview_btn.pack(side=tk.LEFT)

        # Content frame (for editor and preview)
        self.content_frame = ttk.Frame(right_frame)
        self.content_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))

        # Text editor with scrollbar
        editor_frame = ttk.Frame(self.content_frame)
        editor_frame.pack(fill=tk.BOTH, expand=True)

        self.content_text = tk.Text(editor_frame, wrap=tk.WORD)
        content_scrollbar = ttk.Scrollbar(editor_frame, orient=tk.VERTICAL, command=self.content_text.yview)
        self.content_text.configure(yscrollcommand=content_scrollbar.set)

        self.content_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        content_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Action buttons
        btn_frame = ttk.Frame(right_frame)
        btn_frame.pack(fill=tk.X)

        ttk.Button(btn_frame, text="New", command=self._create_note).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="Save", command=self._save_note).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="Delete", command=self._delete_note).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="Copy", command=self._copy_note_content).pack(side=tk.LEFT, padx=(0, 5))
        ttk.Button(btn_frame, text="Pin/Unpin", command=self._toggle_pin).pack(side=tk.LEFT)

    def _load_data(self):
        """Load folders and notes from database."""
        self._load_folders()
        self._load_notes()

    def _load_folders(self):
        """Load and display folders."""
        self.folders_list = self.db.get_all_note_folders()
        self.folders_listbox.delete(0, tk.END)

        # Add "All Notes" virtual folder
        self.folders_listbox.insert(tk.END, "All Notes")

        for folder in self.folders_list:
            self.folders_listbox.insert(tk.END, folder['name'])

        # Select "All Notes" by default
        self.folders_listbox.selection_set(0)

        # Refresh folder combobox
        self._refresh_folder_combo()

    def _refresh_folder_combo(self):
        """Update folder combobox values."""
        folder_names = [f['name'] for f in self.folders_list]
        self.folder_combo['values'] = folder_names
        if folder_names:
            self.folder_combo.current(0)

    def _load_notes(self):
        """Load and display notes based on selected folder."""
        if self.selected_folder_id is None:
            # All Notes selected
            self.notes_list = self.db.get_all_notes()
        else:
            self.notes_list = self.db.get_notes_by_folder(self.selected_folder_id)

        self._display_notes()

    def _display_notes(self):
        """Display notes in the listbox with search filter and sort applied."""
        self.notes_listbox.delete(0, tk.END)

        search_text = self.search_entry.get().lower()

        # Filter notes
        filtered = []
        for note in self.notes_list:
            title_match = search_text in note['title'].lower()
            content_match = search_text in (note['content'] or '').lower()
            if title_match or content_match:
                filtered.append(note)

        # Sort notes
        sorted_notes = self._sort_notes(filtered)

        for note in sorted_notes:
            prefix = "* " if note['is_pinned'] else "  "
            self.notes_listbox.insert(tk.END, f"{prefix}{note['title']}")

    def _sort_notes(self, notes_list):
        """Sort notes: pinned first, then by selected criteria."""
        pinned = [n for n in notes_list if n['is_pinned']]
        regular = [n for n in notes_list if not n['is_pinned']]

        if self.sort_by == 'date':
            pinned.sort(key=lambda x: x['updated_at'] or '', reverse=True)
            regular.sort(key=lambda x: x['updated_at'] or '', reverse=True)
        else:  # name
            pinned.sort(key=lambda x: x['title'].lower())
            regular.sort(key=lambda x: x['title'].lower())

        return pinned + regular

    def _filter_notes(self, *args):
        """Filter notes based on search text."""
        self._display_notes()

    def _on_sort_change(self, event=None):
        """Handle sort combobox change."""
        self.sort_by = 'date' if self.sort_var.get() == "By Date" else 'name'
        self._display_notes()

    def _on_folder_select(self, event=None):
        """Handle folder selection."""
        selection = self.folders_listbox.curselection()
        if not selection:
            return

        index = selection[0]
        if index == 0:
            # "All Notes" selected
            self.selected_folder_id = None
        else:
            folder = self.folders_list[index - 1]
            self.selected_folder_id = folder['id']

        self._load_notes()
        self._clear_editor()

    def _on_note_select(self, event=None):
        """Handle note selection."""
        selection = self.notes_listbox.curselection()
        if not selection:
            return

        # Get the note title from listbox (remove pin prefix)
        listbox_text = self.notes_listbox.get(selection[0])
        note_title = listbox_text[2:]  # Remove "* " or "  " prefix

        # Find the note in the list
        for note in self.notes_list:
            if note['title'] == note_title:
                self.selected_note_id = note['id']
                self._load_note_into_editor(note)
                break

    def _load_note_into_editor(self, note):
        """Load note data into editor fields."""
        # Title
        self.title_entry.delete(0, tk.END)
        self.title_entry.insert(0, note['title'])

        # Folder
        if note['folder_id']:
            for i, folder in enumerate(self.folders_list):
                if folder['id'] == note['folder_id']:
                    self.folder_combo.current(i)
                    break
        elif self.folders_list:
            self.folder_combo.current(0)

        # Content
        self.content_text.delete('1.0', tk.END)
        self.content_text.insert('1.0', note['content'] or '')

        # Switch to editor mode
        if self.is_preview_mode:
            self._show_editor()

    def _clear_editor(self):
        """Clear editor fields."""
        self.selected_note_id = None
        self.title_entry.delete(0, tk.END)
        self.content_text.delete('1.0', tk.END)
        if self.folders_list:
            self.folder_combo.current(0)

    def _create_folder(self):
        """Create a new folder."""
        name = simpledialog.askstring("New Folder", "Enter folder name:", parent=self.parent)
        if name and name.strip():
            self.db.create_note_folder(name.strip())
            self._load_folders()

    def _rename_folder(self):
        """Rename selected folder."""
        selection = self.folders_listbox.curselection()
        if not selection or selection[0] == 0:
            messagebox.showwarning("Warning", "Please select a folder to rename (not 'All Notes').", parent=self.parent)
            return

        folder = self.folders_list[selection[0] - 1]
        new_name = simpledialog.askstring(
            "Rename Folder",
            "Enter new folder name:",
            initialvalue=folder['name'],
            parent=self.parent
        )
        if new_name and new_name.strip():
            self.db.update_note_folder(folder['id'], new_name.strip())
            self._load_folders()

    def _delete_folder(self):
        """Delete selected folder."""
        selection = self.folders_listbox.curselection()
        if not selection or selection[0] == 0:
            messagebox.showwarning("Warning", "Please select a folder to delete (not 'All Notes').", parent=self.parent)
            return

        folder = self.folders_list[selection[0] - 1]
        if messagebox.askyesno("Confirm Delete", f"Delete folder '{folder['name']}'?\nNotes will be moved to 'No Folder'.", parent=self.parent):
            self.db.delete_note_folder(folder['id'])
            self.selected_folder_id = None
            self._load_folders()
            self._load_notes()

    def _create_note(self):
        """Create a new note."""
        # Get folder from combobox
        folder_name = self.folder_combo_var.get()
        folder_id = None
        for folder in self.folders_list:
            if folder['name'] == folder_name:
                folder_id = folder['id']
                break

        title = self.title_entry.get().strip() or "New Note"
        content = self.content_text.get('1.0', tk.END).rstrip()

        new_id = self.db.create_note(folder_id, title, content)
        self.selected_note_id = new_id
        self._load_notes()

        # Select the new note in listbox
        for i in range(self.notes_listbox.size()):
            item_text = self.notes_listbox.get(i)
            if item_text[2:] == title:
                self.notes_listbox.selection_clear(0, tk.END)
                self.notes_listbox.selection_set(i)
                self.notes_listbox.see(i)
                break

    def _save_note(self):
        """Save the current note."""
        if self.selected_note_id is None:
            messagebox.showwarning("Warning", "No note selected. Use 'New' to create a note.", parent=self.parent)
            return

        # Get folder from combobox
        folder_name = self.folder_combo_var.get()
        folder_id = None
        for folder in self.folders_list:
            if folder['name'] == folder_name:
                folder_id = folder['id']
                break

        title = self.title_entry.get().strip()
        if not title:
            messagebox.showwarning("Warning", "Title cannot be empty.", parent=self.parent)
            return

        content = self.content_text.get('1.0', tk.END).rstrip()

        self.db.update_note(self.selected_note_id, folder_id, title, content)
        self._load_notes()

    def _delete_note(self):
        """Delete the selected note."""
        if self.selected_note_id is None:
            messagebox.showwarning("Warning", "No note selected.", parent=self.parent)
            return

        if messagebox.askyesno("Confirm Delete", "Delete this note?", parent=self.parent):
            self.db.delete_note(self.selected_note_id)
            self._clear_editor()
            self._load_notes()

    def _copy_note_content(self):
        """Copy note content to clipboard."""
        content = self.content_text.get('1.0', tk.END).rstrip()
        if content:
            pyperclip.copy(content)

    def _toggle_pin(self):
        """Toggle pin status of selected note."""
        if self.selected_note_id is None:
            messagebox.showwarning("Warning", "No note selected.", parent=self.parent)
            return

        self.db.toggle_note_pin(self.selected_note_id)
        self._load_notes()

    def _show_editor(self):
        """Show the text editor."""
        self.is_preview_mode = False

        # Hide preview if visible
        if self.preview_label:
            self.preview_label.pack_forget()

        # Show editor
        self.content_text.master.pack(fill=tk.BOTH, expand=True)

    def _show_preview(self):
        """Show Markdown preview."""
        self.is_preview_mode = True

        # Get content and convert to HTML
        md_content = self.content_text.get('1.0', tk.END)
        html_content = markdown.markdown(
            md_content,
            extensions=['tables', 'fenced_code', 'nl2br']
        )

        # Wrap in basic HTML structure
        html_full = f"""
        <html>
        <body style="font-family: Arial, sans-serif; padding: 10px;">
        {html_content}
        </body>
        </html>
        """

        # Hide editor
        self.content_text.master.pack_forget()

        # Create or update preview label
        if self.preview_label is None:
            self.preview_label = HTMLLabel(self.content_frame, html=html_full)
        else:
            self.preview_label.set_html(html_full)

        self.preview_label.pack(fill=tk.BOTH, expand=True)
