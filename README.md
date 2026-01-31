# pomoflow

Minimalist Pomodoro timer with a local Python server that auto-exits when you close the tab.

No dependencies. No accounts. No tracking. Just focus.

## Features

- **Timer modes**: Pomodoro (25 min), Short Break (5 min), Long Break (15 min)
- **Timer styles**: Minimal, Circular progress (smooth animation), Flip clock (animated)
- **17 color themes**: Recent themes for quick access, expandable grid to browse all
- **Custom themes**: Create your own with color pickers for each timer mode
- **Appearance options**: Color background toggle, dark background when running
- **Keyboard shortcuts**: Space (start/pause), R (reset), N (next)
- **Session tracking**: Goal counter, completed count
- **Export/Import**: Save and share your settings (including custom themes) as JSON
- **Auto-close**: Server exits when browser tab closes, refresh keeps it alive

## Usage

```bash
python3 run.py                 # Start server (opens browser)
python3 run.py --help          # Show all options
python3 run.py --set-port 8888 # Set default port
python3 run.py --no-browser    # Start without opening browser
```

## Requirements

- Python 3.6+
- No external dependencies

## How it works

1. `run.py` starts a local HTTP server
2. Opens your default browser to the timer
3. Browser sends heartbeats to keep server alive
4. Close the tab → server exits automatically
5. Refresh the page → server stays running (3s grace period)

## License

MIT
