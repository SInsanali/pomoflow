import os, socket, shutil

PROFILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".chrome-profile")

def is_server_up(port):
    try:
        with socket.create_connection(("localhost", port), timeout=0.3):
            return True
    except OSError:
        return False

_CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
]

def find_chrome():
    for c in _CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
        found = shutil.which(c)
        if found:
            return found
    return None

def chrome_app_cmd(url, profile_dir):
    return [find_chrome() or "google-chrome",
            f"--app={url}", f"--user-data-dir={profile_dir}", "--new-window"]

def resolve_port():
    # reuse existing config loader for the saved port
    import pomoflow
    return pomoflow.load_config().get("port", pomoflow.DEFAULT_PORT)
