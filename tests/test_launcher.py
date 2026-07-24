import launcher

def test_is_server_up_false_on_closed_port():
    assert launcher.is_server_up(1) is False  # port 1 not listening

def test_chrome_app_cmd_shape():
    cmd = launcher.chrome_app_cmd("http://localhost:8888", "/tmp/prof")
    assert any(a.startswith("--app=") for a in cmd)
    assert any(a.startswith("--user-data-dir=") for a in cmd)
