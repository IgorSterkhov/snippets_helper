# Keyboard Helper

A Python application that helps you manage and quickly access text snippets using keyboard shortcuts.

## Features

- Global keyboard shortcut (double Shift) to show/hide the application
- Search and filter text snippets
- Copy snippets to clipboard
- Create, edit, and delete snippets
- Persistent storage in DuckDB database
- Always-on-top window when activated

## Requirements

- Python 3.6 or higher
- Required packages (install using pip):
  - pynput
  - pyperclip
  - duckdb
  - python-dotenv

## Installation

1. Clone or download this repository
2. Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```
3. Create a `.env` file in the project root with the following content:
   ```
   DUCKDB_PATH=/path/to/your/database/file
   ```
4. Initialize the database:
   ```bash
   python create_duckdb.py
   ```

## Usage

1. Run the program:
   ```bash
   python main.py
   ```

2. The program will run in the background, listening for keyboard shortcuts
3. Press Shift twice quickly to show the application window
4. Press Escape or double Shift again to hide the window

### Window Controls

- **Inputter**: Search box to filter snippets
- **Selector**: List of available snippets
- **Copy to Clipboard**: Copy selected snippet to clipboard (or press Enter)
- **Save**: Save changes to the selected snippet
- **Create New**: Create a new snippet
- **Delete**: Delete the selected snippet
- **ShortCut Name**: Name/title of the snippet
- **ShortCut Value**: Content of the snippet
- **ShortCut Description**: Extended description of the snippet

### Keyboard Navigation

- **Tab**: Cycle through window elements
- **Enter**: Copy selected snippet to clipboard and close window
- **Escape**: Close window
- **Double Shift**: Show/hide window

## Data Storage

The program stores all snippets in a DuckDB database. Each snippet has:
- `id`: Unique identifier
- `name`: Display name/title
- `value`: The actual text content
- `description`: Extended description of the snippet

The database path is configured in the `.env` file. 