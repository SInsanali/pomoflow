import json, threading, urllib.request, urllib.error
import pomoflow

def _start(tmp_path):
    srv = pomoflow.make_server(0, str(tmp_path / "t.db"), "web")
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    return srv, port

def _get(port, path):
    with urllib.request.urlopen(f"http://localhost:{port}{path}") as r:
        return r.status, r.read().decode()

def test_serves_index(tmp_path):
    srv, port = _start(tmp_path)
    try:
        status, body = _get(port, "/index.html")
        assert status == 200 and "ok" in body
    finally:
        srv.shutdown()

def test_no_heartbeat_endpoint(tmp_path):
    srv, port = _start(tmp_path)
    try:
        try:
            _get(port, "/heartbeat")
            assert False, "heartbeat should not exist"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()
