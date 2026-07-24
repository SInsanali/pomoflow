import http.server, socketserver, os, json
from functools import partial
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

    def do_GET(self):
        if self.path == "/":
            self.path = "/landing.html"
        return super().do_GET()

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def make_server(port, db_path, web_dir):
    conn = dbmod.connect(db_path)
    handler = partial(PomoHandler, directory=web_dir, conn=conn)
    srv = ReusableTCPServer(("localhost", port), handler)
    srv.pomo_conn = conn
    return srv
