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
        # Assert on a real page marker (not an incidental substring).
        assert status == 200 and "Pomodoro" in body
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

def _put(port, path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

def test_stats_endpoint(tmp_path):
    srv, port = _start(tmp_path)
    try:
        _post(port, "/api/sessions", _sess())
        status, body = _get(port, "/api/stats?tz=0")
        assert json.loads(body)["totals"]["all_time_blocks"] == 1
    finally:
        srv.shutdown()

def test_settings_and_presets(tmp_path):
    srv, port = _start(tmp_path)
    try:
        _put(port, "/api/settings", {"theme": "ocean"})
        assert json.loads(_get(port, "/api/settings")[1])["theme"] == "ocean"
        created = _post(port, "/api/presets", {"name": "P1", "config": {"theme": "ocean"}})[1]
        assert created["name"] == "P1"
        assert len(json.loads(_get(port, "/api/presets")[1])["presets"]) == 1
    finally:
        srv.shutdown()

def _status_of(port, path, method="GET", raw=None, obj=None):
    """Return the HTTP status for a request, capturing 4xx/5xx via HTTPError."""
    data = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else None)
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"} if data else {},
                                 method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

def test_malformed_input_returns_400(tmp_path):
    srv, port = _start(tmp_path)
    try:
        # Missing required session fields.
        assert _status_of(port, "/api/sessions", "POST", obj={"id": "x"}) == 400
        # Missing preset name/config.
        assert _status_of(port, "/api/presets", "POST", obj={}) == 400
        # Non-integer tz.
        assert _status_of(port, "/api/stats?tz=abc", "GET") == 400
        # Body that isn't valid JSON.
        assert _status_of(port, "/api/settings", "PUT", raw=b"{not json") == 400
        # A well-formed request still succeeds (no false positives).
        assert _status_of(port, "/api/stats?tz=0", "GET") == 200
    finally:
        srv.shutdown()

def test_quit_shuts_down_server(tmp_path):
    srv = pomoflow.make_server(0, str(tmp_path / "t.db"), "web")
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    try:
        status, body = _post(port, "/api/quit", {})
        assert status == 200 and body == {"quitting": True}
        # The quit handler triggers server.shutdown() on a background thread;
        # serve_forever should return, ending the serving thread promptly.
        t.join(timeout=5)
        assert not t.is_alive()
    finally:
        srv.server_close()
