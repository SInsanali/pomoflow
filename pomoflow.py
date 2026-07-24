import http.server, socketserver, os, json
from functools import partial
from urllib.parse import urlparse, parse_qs
import db as dbmod

DEFAULT_PORT = 8888

class PomoHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, directory=None, conn=None, **k):
        self.conn = conn
        super().__init__(*a, directory=directory, **k)

    def log_message(self, fmt, *args):
        pass  # quiet; API tasks add real logging if desired

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        p, q = parsed.path, parse_qs(parsed.query)
        if p == "/api/sessions":
            return self._send_json({"sessions": dbmod.get_sessions(
                self.conn, q.get("from", [None])[0], q.get("to", [None])[0])})
        if p == "/api/stats":
            tz = int(q.get("tz", ["0"])[0])
            return self._send_json(dbmod.get_stats(
                self.conn, q.get("from", [None])[0], q.get("to", [None])[0], tz))
        if p == "/api/settings":
            return self._send_json(dbmod.get_settings(self.conn) or {})
        if p == "/api/presets":
            return self._send_json({"presets": dbmod.list_presets(self.conn)})
        if self.path == "/":
            self.path = "/landing.html"
        return super().do_GET()

    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/api/sessions":
            return self._send_json({"created": dbmod.insert_session(self.conn, self._read_json())})
        if p == "/api/presets":
            body = self._read_json()
            return self._send_json(dbmod.create_preset(self.conn, body["name"], body["config"]))
        if p == "/api/quit":
            self._send_json({"quitting": True})
            import threading; threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self._send_json({"error": "not found"}, 404)

    def do_PUT(self):
        if urlparse(self.path).path == "/api/settings":
            dbmod.put_settings(self.conn, self._read_json())
            return self._send_json({"saved": True})
        self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "presets":
            return self._send_json({"deleted": dbmod.delete_preset(self.conn, parts[2])})
        self._send_json({"error": "not found"}, 404)

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def make_server(port, db_path, web_dir):
    conn = dbmod.connect(db_path)
    handler = partial(PomoHandler, directory=web_dir, conn=conn)
    srv = ReusableTCPServer(("localhost", port), handler)
    srv.pomo_conn = conn
    return srv

# --- port config (carried over from old run.py) ---
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pomodoro_config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                return {"port": DEFAULT_PORT, **json.load(f)}
        except Exception:
            pass
    return {"port": DEFAULT_PORT}

def serve_main(port=None, db_path=None, web_dir=None):
    port = port or load_config().get("port", DEFAULT_PORT)
    db_path = db_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "pomoflow.db")
    web_dir = web_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    srv = make_server(port, db_path, web_dir)
    print(f"Pomoflow running at http://localhost:{port}  (Ctrl+C or Quit button to stop)")
    try:
        srv.serve_forever()
    finally:
        srv.server_close()

if __name__ == "__main__":
    serve_main()
