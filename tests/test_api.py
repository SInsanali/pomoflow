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

def _post(port, path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

def _sess(id="a"):
    return dict(id=id, mode="pomodoro", started_at="2026-07-23T10:00:00Z",
                ended_at="2026-07-23T10:25:00Z", planned_seconds=1500,
                actual_seconds=1500, completed=1)

def test_post_session_idempotent(tmp_path):
    srv, port = _start(tmp_path)
    try:
        assert _post(port, "/api/sessions", _sess())[1] == {"created": True}
        assert _post(port, "/api/sessions", _sess())[1] == {"created": False}
        status, body = _get(port, "/api/sessions")
        assert len(json.loads(body)["sessions"]) == 1
    finally:
        srv.shutdown()
