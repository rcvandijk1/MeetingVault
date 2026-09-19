from datetime import datetime, timedelta, timezone

import pytest

from thinktank.ledger import LedgerError, parse_deadline

from conftest import post


def test_post_requires_every_field(ledger):
    with pytest.raises(LedgerError) as e:
        ledger.post_problem(mode="", question="", decision="", must_answer=[], evidence_standard="", deliverable="",
                            token_cap=0, deadline="")
    msg = str(e.value)
    for needle in ("mode", "question", "decision", "must-answer", "evidence", "deliverable", "deadline"):
        assert needle in msg


def test_confidential_post_rejected(ledger):
    with pytest.raises(LedgerError, match="confidential"):
        post(ledger, confidential=True)


def test_must_answer_bounds(ledger):
    with pytest.raises(LedgerError, match="3 to 7"):
        post(ledger, must_answer=["a", "b"])
    with pytest.raises(LedgerError, match="3 to 7"):
        post(ledger, must_answer=list("abcdefgh"))


def test_deadline_hhmm_is_next_occurrence():
    now = datetime(2026, 9, 19, 22, 0, tzinfo=timezone.utc)
    assert parse_deadline("07:00", now) == "2026-09-20T07:00:00+00:00"
    assert parse_deadline("23:30", now) == "2026-09-19T23:30:00+00:00"
    with pytest.raises(LedgerError, match="past"):
        parse_deadline("2020-01-01T00:00:00+00:00", now)


def test_default_token_cap_applied(ledger, config):
    pid = post(ledger, token_cap=None)
    assert ledger.get_problem(pid)["token_cap"] == config.default_problem_token_cap


def test_split_rules(ledger, config):
    pid = post(ledger, token_cap=1000)
    with pytest.raises(LedgerError, match="merging owner"):
        ledger.create_task(pid, title="x", criteria="y", budget_tokens=10, merge_owner="")
    t1 = ledger.create_task(pid, title="a", criteria="c", budget_tokens=600, merge_owner="lead")
    with pytest.raises(LedgerError, match="exceeds what the parent has left"):
        ledger.create_task(pid, title="b", criteria="c", budget_tokens=500, merge_owner="lead")
    t2 = ledger.create_task(pid, title="a1", criteria="c", budget_tokens=300, merge_owner="lead", parent_id=t1)
    assert ledger.get_task(t2)["depth"] == 2
    with pytest.raises(LedgerError, match="depth"):
        ledger.create_task(pid, title="a1a", criteria="c", budget_tokens=10, merge_owner="lead", parent_id=t2)
    with pytest.raises(LedgerError, match="exceeds"):
        ledger.create_task(pid, title="a2", criteria="c", budget_tokens=301, merge_owner="lead", parent_id=t1)


def test_lease_expires_once_then_escalates(ledger):
    pid = post(ledger)
    tid = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    ledger.lease_task(tid, "r1")
    with pytest.raises(LedgerError, match="not open"):
        ledger.lease_task(tid, "r2")
    assert ledger.release_task(tid, "lease expired") == "open"
    ledger.lease_task(tid, "r2")
    assert ledger.release_task(tid, "lease expired") == "escalated"
    assert ledger.get_task(tid)["status"] == "escalated"


def test_expire_leases_uses_clock(ledger, config):
    pid = post(ledger)
    tid = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    ledger.lease_task(tid, "r1")
    assert ledger.expire_leases(pid) == []
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    ledger.conn.execute("UPDATE tasks SET lease_expires_at=? WHERE id=?", (past, tid))
    assert ledger.expire_leases(pid) == ["open"]


def test_note_schema_limits(ledger, config):
    pid = post(ledger)
    kw = dict(task_id=None, run_id=None, url="https://x.example/a", quote="q", source_date="2026-01-01")
    with pytest.raises(LedgerError, match="claim is required"):
        ledger.post_note(pid, claim="", **kw)
    with pytest.raises(LedgerError, match="longer than"):
        ledger.post_note(pid, claim="x" * (config.note_claim_max_chars + 1), **kw)
    with pytest.raises(LedgerError, match="http"):
        ledger.post_note(pid, claim="c", task_id=None, run_id=None, url="ftp://nope", quote="q", source_date=None)
    with pytest.raises(LedgerError, match="claim_type"):
        ledger.post_note(pid, claim="c", claim_type="rumour", **kw)
    nid = ledger.post_note(pid, claim="c", **kw)
    assert ledger.get_note(nid)["status"] == "unverified"


def test_verify_note_creates_claim_with_expiry_and_single_source_flag(ledger, config):
    pid = post(ledger)
    n1 = ledger.post_note(pid, task_id=None, run_id=None, claim="ACME charges 10k", url="https://a.example/p", quote="10k", source_date="2026-01-01", claim_type="price")
    cid = ledger.verify_note(n1, verified=True, reason="found", run_id="critic1", tags="acme,price")
    c = ledger.get_claim(cid)
    assert c["single_source"] == 1
    assert c["expires_at"] is not None
    with pytest.raises(LedgerError, match="already"):
        ledger.verify_note(n1, verified=True, reason="again", run_id="critic1")
    n2 = ledger.post_note(pid, task_id=None, run_id=None, claim="ACME charges 10k", url="https://b.example/q", quote="10k", source_date="2026-02-01", claim_type="price")
    c2 = ledger.verify_note(n2, verified=True, reason="found", run_id="critic1")
    assert ledger.get_claim(cid)["single_source"] == 0
    assert ledger.get_claim(c2)["single_source"] == 0
    n3 = ledger.post_note(pid, task_id=None, run_id=None, claim="made up", url="https://c.example/", quote="nope", source_date=None)
    assert ledger.verify_note(n3, verified=False, reason="quote not on page", run_id="critic1") is None
    assert ledger.get_note(n3)["status"] == "rejected"
    hist = ledger.post_note(pid, task_id=None, run_id=None, claim="founded 1990", url="https://d.example/", quote="1990", source_date=None, claim_type="historical")
    assert ledger.get_claim(ledger.verify_note(hist, verified=True, reason="ok", run_id="c"))["expires_at"] is None


def test_search_claims_hides_expired_unless_asked(ledger):
    pid = post(ledger)
    n = ledger.post_note(pid, task_id=None, run_id=None, claim="Broadcaster X uses vendor Y", url="https://a.example/", quote="uses Y", source_date=None, claim_type="capability")
    cid = ledger.verify_note(n, verified=True, reason="ok", run_id="c", tags="broadcast")
    assert [c["id"] for c in ledger.search_claims("vendor broadcaster")] == [cid]
    ledger.conn.execute("UPDATE claims SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?", (cid,))
    assert ledger.search_claims("vendor") == []
    got = ledger.search_claims("vendor", include_expired=True)
    assert got and got[0]["expired"] is True
    assert ledger.purge_source("https://a.example") == 1
    assert ledger.search_claims("vendor", include_expired=True) == []


def test_critique_objections_must_target_claim_or_item(ledger):
    pid = post(ledger)
    did = ledger.submit_deliverable(pid, body="x", unanswered=[], disagreements="", run_id=None)
    with pytest.raises(LedgerError, match="claim_id or a must_answer_item"):
        ledger.post_critique(pid, deliverable_id=did, round_no=1, body="b", objections=[{"objection": "vague"}], run_id=None)
    with pytest.raises(LedgerError, match="unknown claim"):
        ledger.post_critique(pid, deliverable_id=did, round_no=1, body="b", objections=[{"claim_id": "c_nope", "objection": "x"}], run_id=None)
    ledger.post_critique(pid, deliverable_id=did, round_no=1, body="b", objections=[{"must_answer_item": "Vendors", "objection": "missing"}], run_id=None)
    with pytest.raises(LedgerError, match="maximum 2"):
        ledger.post_critique(pid, deliverable_id=did, round_no=3, body="b", objections=[], run_id=None)


def test_option_repair_is_author_only_and_once(ledger):
    pid = post(ledger, mode="ideas")
    oid = ledger.post_option(pid, slot=0, run_id=None, title="t", body="b")
    with pytest.raises(LedgerError, match="only the author"):
        ledger.repair_option(oid, slot=1, body="x")
    ledger.repair_option(oid, slot=0, body="x")
    with pytest.raises(LedgerError, match="one repair"):
        ledger.repair_option(oid, slot=0, body="y")
