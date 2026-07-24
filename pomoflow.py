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
        if parsed.path == "/api/sessions":
            q = parse_qs(parsed.query)
            rows = dbmod.get_sessions(self.conn, q.get("from", [None])[0], q.get("to", [None])[0])
            return self._send_json({"sessions": rows})
        if self.path == "/":
            self.path = "/landing.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sessions":
            created = dbmod.insert_session(self.conn, self._read_json())
            return self._send_json({"created": created})
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
