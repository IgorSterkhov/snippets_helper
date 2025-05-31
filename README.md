# Keyboard Helper

A Python application that helps you manage and quickly access text snippets using keyboard shortcuts.

## Features

- Global keyboard shortcut (double Shift) to show/hide the application
- Search and filter text snippets
- Copy snippets to clipboard
- Create, edit, and delete snippets
- Persistent storage in JSON format
- Always-on-top window when activated

## Requirements

- Python 3.6 or higher
- Required packages (install using pip):
  - keyboard
  - pyperclip

## Installation

1. Clone or download this repository
2. Install the required packages:
   ```bash
   pip install -r requirements.txt
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

### Keyboard Navigation

- **Tab**: Cycle through window elements
- **Enter**: Copy selected snippet to clipboard and close window
- **Escape**: Close window
- **Double Shift**: Show/hide window

## Data Storage

The program stores all snippets in a file called `items.json` in the same directory as the program. Each snippet has:
- `id`: Unique identifier
- `name`: Display name/title
- `value`: The actual text content 