"""Attention: unread replies, open escalations, and a supervisor heartbeat,
served as JSON for the tab you keep open."""
import json
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer

from thinktank.supervisor import Supervisor
from thinktank.web import Handler

from conftest import FakeRunner, fake_fetcher, post


def test_attention_items_and_heartbeat(ledger, config):
    a = ledger.attention()
    assert a["name"] == config.system_name and a["daemon_alive"] is False
    assert [i["kind"] for i in a["items"]] == ["daemon"] and "never" in a["daemon_status"]
    ledger.heartbeat("idle")
    a = ledger.attention()
    assert a["daemon_alive"] and a["count"] == 0 and a["daemon_status"] == "idle"
    # a stale heartbeat counts as dead
    stale = (datetime.now(timezone.utc) - timedelta(seconds=config.heartbeat_seconds * 3 + 60)).replace(microsecond=0).isoformat()
    ledger.conn.execute("UPDATE state SET updated_at=? WHERE key='daemon'", (stale,))
    a = ledger.attention()
    assert not a["daemon_alive"] and a["items"][0]["kind"] == "daemon" and "last seen" in a["items"][0]["text"]
    ledger.heartbeat("running p_x")
    # a reply is attention until opened; an escalation until resolved
    pid = post(ledger)
    did = ledger.submit_deliverable(pid, body="x", unanswered=[], disagreements="", run_id=None)
    rid = ledger.post_reply(pid, did, "body")
    eid = ledger.escalate(pid, "judge failed", "partial")
    a = ledger.attention()
    assert a["count"] == 2 and [i["kind"] for i in a["items"]] == ["reply", "escalation"]
    assert a["items"][0]["href"] == f"/reply/{rid}" and a["items"][0]["problem_id"] == pid
    assert ledger.mark_reply_seen(rid) == 1 and ledger.mark_reply_seen(rid) == 0
    ledger.resolve_escalation(eid)
    assert ledger.attention()["count"] == 0
    ledger.post_reply(pid, did, "second")
    assert ledger.mark_reply_seen(None) == 1


def test_daemon_beats_and_a_passed_problem_becomes_attention(config, db, ledger):
    config.heartbeat_seconds = 1
    sup = Supervisor(config, db, FakeRunner(db, config), fetcher=fake_fetcher())
    pid = post(ledger)
    sup.daemon(once=True)
    a = ledger.attention()
    assert a["count"] == 1 and a["items"][0]["kind"] == "reply" and a["items"][0]["problem_id"] == pid
    assert a["daemon_status"] == "stopped"  # once=True ends the daemon; the board says so
    assert any(e["kind"] == "attention" for e in ledger.events(pid))
    assert config.system_name in ledger.list_replies()[0]["body"]


def test_api_and_reply_pages(config, db, ledger):
    Handler.config, Handler.db_path = config, db
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    try:
        pid = post(ledger)
        did = ledger.submit_deliverable(pid, body="x", unanswered=[], disagreements="", run_id=None)
        rid = ledger.post_reply(pid, did, "the reply body")
        a = json.loads(urllib.request.urlopen(base + "/api/attention").read())
        assert a["count"] == 2 and {i["kind"] for i in a["items"]} == {"reply", "daemon"}
        html = urllib.request.urlopen(base + "/replies").read().decode()
        assert "class='unread'" in html and "Mark all as read" in html and f"<title>{config.system_name}" in html
        html = urllib.request.urlopen(base + f"/reply/{rid}").read().decode()
        assert "the reply body" in html and "id=attention" in html and "/api/attention" in html
        a = json.loads(urllib.request.urlopen(base + "/api/attention").read())
        assert [i["kind"] for i in a["items"]] == ["daemon"]  # opening the reply marked it seen
    finally:
        srv.shutdown()
