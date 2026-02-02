#!/usr/bin/env python3
"""
Pomodoro Timer Server

A simple HTTP server that:
- Serves the Pomodoro timer web app
- Monitors browser heartbeat to detect tab close
- Auto-opens browser on startup
- Handles clean shutdown on Ctrl+C

Usage:
  python3 run.py              Start server on configured port
  python3 run.py --set-port   Set and save default port
  python3 run.py --config     Show current configuration
  python3 run.py --help       Show help
"""

import http.server
import socketserver
import threading
import time
import webbrowser
import signal
import sys
import os
import json
from functools import partial

# Configuration
DEFAULT_PORT = 8888
HEARTBEAT_TIMEOUT = 120  # seconds without heartbeat before shutdown (browsers heavily throttle background tabs)
HEARTBEAT_CHECK_INTERVAL = 5  # seconds between heartbeat checks
SHUTDOWN_GRACE_PERIOD = 3  # seconds to wait after shutdown request (allows reload)

# Config file path (same directory as script)
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.pomodoro_config.json')

# Global state
last_heartbeat = time.time()
server = None
shutdown_flag = threading.Event()
shutdown_requested = False
shutdown_request_time = 0


def load_config():
    """Load configuration from file."""
    defaults = {'port': DEFAULT_PORT}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
                return {**defaults, **config}
        except:
            pass
    return defaults


def save_config(config):
    """Save configuration to file."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def show_config():
    """Display current configuration."""
    config = load_config()
    print(f"""
Pomodoro Timer Configuration
============================
Config file: {CONFIG_FILE}
Default port: {config.get('port', DEFAULT_PORT)}
""")


def set_port(port):
    """Set and save default port."""
    config = load_config()
    config['port'] = port
    save_config(config)
    print(f"Default port set to {port}")


class PomodoroHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler with heartbeat and shutdown endpoints."""

    def __init__(self, *args, directory=None, **kwargs):
        self.directory = directory
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format, *args):
        """Suppress default logging for cleaner output."""
        msg = str(args[0]) if args else ''
        # Hide heartbeat, shutdown, and static asset requests
        if '/heartbeat' in msg or '/shutdown' in msg or '/fonts/' in msg:
            return
        print(f"[{self.log_date_time_string()}] {msg}")

    def do_GET(self):
        global last_heartbeat, shutdown_requested

        if self.path == '/heartbeat':
            last_heartbeat = time.time()
            shutdown_requested = False  # Cancel any pending shutdown (page reloaded)
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(b'ok')
            return

        if self.path == '/shutdown':
            # Use POST /shutdown instead - this just acknowledges
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'use POST')
            return

        # Serve index.html for root
        if self.path == '/':
            self.path = '/index.html'

        # Add no-cache headers for HTML files
        if self.path.endswith('.html'):
            return self.serve_no_cache()

        return super().do_GET()

    def serve_no_cache(self):
        """Serve file with no-cache headers."""
        try:
            file_path = os.path.join(self.directory, self.path.lstrip('/'))
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(content))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(404, f'File not found: {e}')

    def do_POST(self):
        """Handle POST requests (for sendBeacon)."""
        global shutdown_requested, shutdown_request_time

        if self.path == '/shutdown':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'noted')
            # Don't shutdown immediately - set flag and let heartbeat monitor decide
            # This allows page reloads without killing the server
            shutdown_requested = True
            shutdown_request_time = time.time()
            return

        self.send_response(404)
        self.end_headers()


def find_available_port(start_port=DEFAULT_PORT):
    """Find an available port starting from start_port."""
    import socket

    port = start_port
    while port < start_port + 100:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except (AttributeError, OSError):
                    pass
                s.bind(('localhost', port))
                return port
        except OSError:
            port += 1

    # Fallback: let OS assign a port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('localhost', 0))
        return s.getsockname()[1]


def heartbeat_monitor():
    """Background thread that checks for heartbeat timeout."""
    global last_heartbeat, shutdown_requested

    # Give browser time to load and send first heartbeat
    time.sleep(HEARTBEAT_TIMEOUT)

    while not shutdown_flag.is_set():
        time.sleep(1)  # Check more frequently for better responsiveness

        if shutdown_flag.is_set():
            break

        # Check if shutdown was requested (tab close/reload)
        if shutdown_requested:
            # Wait for grace period to see if heartbeat resumes (reload vs close)
            grace_elapsed = time.time() - shutdown_request_time
            heartbeat_elapsed = time.time() - last_heartbeat

            if grace_elapsed > SHUTDOWN_GRACE_PERIOD and heartbeat_elapsed > SHUTDOWN_GRACE_PERIOD:
                # No heartbeat after grace period - tab was actually closed
                initiate_shutdown("Browser tab closed")
                break
            elif heartbeat_elapsed < 2:
                # Heartbeat resumed - was just a reload
                shutdown_requested = False
                continue

        # Normal heartbeat timeout check
        elapsed = time.time() - last_heartbeat
        if elapsed > HEARTBEAT_TIMEOUT:
            initiate_shutdown(f"No heartbeat for {elapsed:.0f} seconds (tab likely closed)")
            break


def initiate_shutdown(reason="Unknown"):
    """Initiate server shutdown."""
    if shutdown_flag.is_set():
        return  # Already shutting down

    print(f"\n[Shutdown] {reason}")
    shutdown_flag.set()

    if server:
        # Shutdown server in a thread to avoid blocking
        threading.Thread(target=server.shutdown).start()


def signal_handler(signum, frame):
    """Handle Ctrl+C and other termination signals."""
    signal_name = signal.Signals(signum).name
    print(f"\n[Shutdown] Received {signal_name}")
    print("\n[Server stopped]")
    os._exit(0)


def is_wsl():
    """Check if running in Windows Subsystem for Linux."""
    try:
        with open('/proc/version', 'r') as f:
            return 'microsoft' in f.read().lower()
    except:
        return False


def open_browser(url):
    """Open browser after a short delay to ensure server is ready."""
    time.sleep(0.5)

    if is_wsl():
        # WSL: Use Windows browser via cmd.exe
        import subprocess
        try:
            # cmd.exe /c start opens URL in default Windows browser
            subprocess.run(['cmd.exe', '/c', 'start', url.replace('&', '^&')],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            pass

    # macOS, Windows, or native Linux with browser installed
    webbrowser.open(url)


def print_help():
    """Print custom help message."""
    print("""
Pomodoro Timer Server

Usage:
  python3 run.py                 # Start server on configured port
  python3 run.py --help          # Show help
  python3 run.py --config        # Show current configuration
  python3 run.py --set-port 8888 # Save default port to config
  python3 run.py --port 9000     # Use port for this session only
  python3 run.py --no-browser    # Don't auto-open browser
""")


def main():
    global server, last_heartbeat

    # Simple arg parsing
    args = sys.argv[1:]

    if '--help' in args or '-h' in args:
        print_help()
        return

    if '--config' in args:
        show_config()
        return

    if '--set-port' in args:
        try:
            idx = args.index('--set-port')
            port = int(args[idx + 1])
            set_port(port)
            return
        except (IndexError, ValueError):
            print("Error: --set-port requires a port number")
            return

    # Parse remaining options
    no_browser = '--no-browser' in args
    session_port = None

    if '--port' in args:
        try:
            idx = args.index('--port')
            session_port = int(args[idx + 1])
        except (IndexError, ValueError):
            print("Error: --port requires a port number")
            return

    # Load config
    config = load_config()

    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Determine port: CLI arg > config file > default
    preferred_port = session_port if session_port else config.get('port', DEFAULT_PORT)

    # Find available port
    port = find_available_port(preferred_port)
    url = f"http://localhost:{port}"

    if port != preferred_port:
        print(f"Note: Port {preferred_port} was busy, using {port} instead")

    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Create handler with custom directory
    handler = partial(PomodoroHandler, directory=script_dir)

    # Create server with reusable address and port
    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

        def server_bind(self):
            import socket
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # Try SO_REUSEPORT if available (macOS/Linux)
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except (AttributeError, OSError):
                pass
            super().server_bind()

    server = ReusableTCPServer(("localhost", port), handler)

    print(f"""
    ===============================
       Pomodoro Timer
    ===============================

    Server running at: {url}

    Controls:
      Ctrl+C    Quit server
      Close tab Server auto-exits

    """)

    # Reset heartbeat timestamp
    last_heartbeat = time.time()

    # Start heartbeat monitor thread
    monitor_thread = threading.Thread(target=heartbeat_monitor, daemon=True)
    monitor_thread.start()

    # Open browser in background thread (unless --no-browser)
    if not no_browser:
        browser_thread = threading.Thread(target=open_browser, args=(url,), daemon=True)
        browser_thread.start()

    # Run server (blocks until shutdown)
    try:
        server.serve_forever()
    except Exception as e:
        if not shutdown_flag.is_set():
            print(f"Server error: {e}")
    finally:
        # Properly close socket to release port immediately
        try:
            server.socket.close()
        except:
            pass
        server.server_close()
        print("\n[Server stopped]")


if __name__ == '__main__':
    main()
