from datetime import datetime, timezone

from thinktank.runner import RunResult
from thinktank.supervisor import Supervisor
from thinktank.verify import Fetched

from conftest import FakeRunner, fake_fetcher, post


def make(config, db, behaviours=None, pages=None, **kw):
    runner = FakeRunner(db, config, behaviours, **kw)
    return Supervisor(config, db, runner, fetcher=fake_fetcher(pages)), runner


def test_research_problem_passes_and_lands_on_reply_board(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    roles = [(s.role, s.stage) for s in runner.calls]
    assert roles[0] == ("lead", "plan")
    assert roles.count(("reader", "read")) == 3
    assert ("critic", "verify") in roles and ("synthesizer", "synthesize") in roles
    assert ("critic", "critique") in roles and roles[-1] == ("judge", "judge")
    assert ("synthesizer", "revise") not in roles  # no objections, no revision
    replies = ledger.list_replies()
    assert len(replies) == 1
    body = replies[0]["body"]
    assert "API-equivalent cost" in body and "Tokens:" in body and "Verified claims (3, 3 single-source)" in body
    p = ledger.get_problem(pid)
    assert p["status"] == "passed" and p["tokens_used"] == 1000 * len(runner.calls)
    assert all(t["status"] == "done" for t in ledger.list_tasks(pid))
    fetches = ledger.list_fetches(pid)
    assert len(fetches) == 3 * 2 + 3 + 3  # readers: search+fetch each; supervisor quote check: one per URL; critic: one per note
    assert sum(f["role"] == "supervisor" for f in fetches) == 3
    assert all(n["quote_check"] == "pass" for n in ledger.list_notes(pid))
    assert all(c["quote_checked"] for c in ledger.claims_for_problem(pid))
    assert "quote not machine-checked" not in body
    assert ledger.list_escalations() == []


def test_quote_not_on_page_is_rejected_before_the_critic_sees_it(config, db, ledger):
    seen_by_critic = []

    def critic(spec, call, on_fetch):
        for n in call("list_notes", status="unverified"):
            seen_by_critic.append(n["claim"])
            assert n["quote_check"] in ("pass", "unsupported")
            call("verify_note", note_id=n["id"], verified=True, reason="date ok, quote supports claim")

    def synth(spec, call, on_fetch):
        claims = call("list_claims")
        call("submit_deliverable", body="\n".join(f"- {c['claim']} [{c['id']}]" for c in claims),
             unanswered=["Pricing model"], disagreements="")

    pages = {
        "https://example.com/pricing-model": Fetched(ok=True, text="This page says nothing of the sort.", content_type="text/html", status=200),
        "https://example.com/named-customers": Fetched(ok=False, status=0, content_type="application/pdf", error="unsupported content type application/pdf"),
    }
    sup, runner = make(config, db, {("critic", "verify"): critic, ("synthesizer", "synthesize"): synth}, pages=pages)
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    notes = {n["claim"].split(":")[0]: n for n in ledger.list_notes(pid)}
    assert notes["Pricing model"]["status"] == "rejected" and notes["Pricing model"]["quote_check"] == "fail"
    assert "mechanical check" in notes["Pricing model"]["verify_reason"]
    assert notes["Named customers"]["quote_check"] == "unsupported" and notes["Named customers"]["status"] == "verified"
    assert notes["Vendors"]["quote_check"] == "pass"
    assert sorted(seen_by_critic) == ["Named customers: fact one", "Vendors: fact one"]
    claims = {c["claim"].split(":")[0]: c for c in ledger.claims_for_problem(pid)}
    assert claims["Vendors"]["quote_checked"] == 1 and claims["Named customers"]["quote_checked"] == 0
    body = ledger.list_replies()[0]["body"]
    assert "1 with quote not machine-checked" in body and "Named customers: fact one — https://example.com/named-customers (2026-05-01) (single source; quote not machine-checked)" in body


def test_critic_cannot_verify_a_note_that_failed_the_mechanical_check(config, db, ledger):
    def cheating_critic(spec, call, on_fetch):
        # Tries to verify every note, including one the supervisor already rejected.
        from thinktank.mcp_server import Context, call_tool
        from thinktank.ledger import Ledger
        L = Ledger(config.db_path, config)
        ctx = Context(role="critic", problem_id=spec.problem_id, run_id=spec.run_id)
        for n in L.list_notes(spec.problem_id):
            result, err = call_tool(L, ctx, "verify_note", {"note_id": n["id"], "verified": True, "reason": "trust me"})
            if n["quote_check"] == "fail":
                assert err and ("already rejected" in result or "mechanical" in result)
        L.close()

    pages = {"https://example.com/vendors": Fetched(ok=True, text="nothing here", content_type="text/html", status=200)}
    sup, runner = make(config, db, {("critic", "verify"): cheating_critic}, pages=pages)
    pid = post(ledger)
    sup.run_problem(pid)
    assert len(ledger.claims_for_problem(pid)) == 2


def test_objections_trigger_exactly_one_revision(config, db, ledger):
    def critique(spec, call, on_fetch):
        d = call("get_deliverable")
        claims = call("list_claims")
        call("post_critique", deliverable_id=d["id"], body="weak", objections=[{"claim_id": claims[0]["id"], "objection": "quote too short"}])

    sup, runner = make(config, db, {("critic", "critique"): critique})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    stages = [s.stage for s in runner.calls]
    assert stages.count("revise") == 1 and stages.count("critique") == 1
    assert ledger.latest_deliverable(pid)["version"] == 2


def test_failed_judgement_escalates_and_never_loops(config, db, ledger):
    def judge(spec, call, on_fetch):
        d = call("get_deliverable")
        call("submit_verdict", deliverable_id=d["id"], passed=False, reasons="Pricing model not covered")

    sup, runner = make(config, db, {("judge", "judge"): judge})
    pid = post(ledger)
    assert sup.run_problem(pid) == "escalated"
    assert [s.stage for s in runner.calls].count("judge") == 1
    esc = ledger.list_escalations()
    assert len(esc) == 1 and "Pricing model" in esc[0]["reason"]
    assert "Deliverable draft v1" in esc[0]["partial"] and "Verified claims so far" in esc[0]["partial"]
    assert ledger.list_replies() == []


def test_token_cap_stops_between_stages(config, db, ledger):
    sup, runner = make(config, db, tokens_per_run=400_000)
    pid = post(ledger, token_cap=1_000_000)
    assert sup.run_problem(pid) == "escalated"
    esc = ledger.list_escalations()[0]
    assert "token cap reached" in esc["reason"]
    p = ledger.get_problem(pid)
    assert p["tokens_used"] >= p["token_cap"]
    # the lead ran, then one batch of readers; nothing after the cap
    assert {s.role for s in runner.calls} <= {"lead", "reader"}


def test_deadline_passed_escalates_before_spawning(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger, deadline="2999-01-01T00:00:00+00:00")
    ledger.conn.execute("UPDATE problems SET deadline='2000-01-01T00:00:00+00:00' WHERE id=?", (pid,))
    assert sup.run_problem(pid) == "escalated"
    assert runner.calls == []
    assert "deadline passed" in ledger.list_escalations()[0]["reason"]


def test_no_cap_means_spend_is_shown_not_enforced(config, db, ledger):
    config.spend_max_usd_month = 1.0
    sup, runner = make(config, db, tokens_per_run=400_000)  # $2 per run at the fake's rate: far past "max spending"
    pid = post(ledger, token_cap=None)
    assert ledger.get_problem(pid)["token_cap"] == 0
    sup.daemon(once=True)
    assert ledger.get_problem(pid)["status"] == "passed"
    spend = sup.governor.spend_status()
    assert spend["month_pct"] > 100 and spend["month_tokens"] == 400_000 * len(runner.calls)
    assert spend["week_usd"] == spend["month_usd"] > 1.0
    body = ledger.list_replies()[0]["body"]
    assert "(no cap)" in body


def test_spend_prices_unreported_runs_at_list_rate(config, db, ledger):
    sup, _ = make(config, db)
    pid = post(ledger)
    ledger.conn.execute("INSERT INTO runs(id, problem_id, role, model, status, started_at, total_tokens, cost_usd) VALUES ('r_a', ?, 'reader', 'haiku', 'ok', ?, 1000000, 0)",
                        (pid, datetime.now(timezone.utc).isoformat()))
    ledger.conn.execute("INSERT INTO runs(id, problem_id, role, model, status, started_at, total_tokens, cost_usd) VALUES ('r_b', ?, 'judge', 'sonnet', 'ok', ?, 10, 0.5)",
                        (pid, datetime.now(timezone.utc).isoformat()))
    s = sup.governor.spend_status()
    assert s["month_tokens"] == 1_000_010 and s["month_usd"] == round(config.usd_per_million_tokens["haiku"] + 0.5, 2)


def test_rate_limit_pauses_and_resumes_at_recorded_stage(config, db, ledger):
    hits = {"n": 0}

    def flaky_verify(spec, call, on_fetch):
        hits["n"] += 1
        if hits["n"] == 1:
            return RunResult(status="rate_limited", error="You have hit your usage limit")
        for n in call("list_notes", status="unverified"):
            call("verify_note", note_id=n["id"], verified=True, reason="ok")

    sup, runner = make(config, db, {("critic", "verify"): flaky_verify})
    pid = post(ledger)
    assert sup.run_problem(pid) == "queued"
    p = ledger.get_problem(pid)
    assert p["status"] == "queued" and p["stage"] == "read" and p["not_before"] > p["created_at"]
    calls_before = len(runner.calls)
    assert sup.run_problem(pid) == "passed"
    later = [(s.role, s.stage) for s in runner.calls[calls_before:]]
    assert ("lead", "plan") not in later and ("reader", "read") not in later  # no re-spend
    assert later[0] == ("critic", "verify")


def test_reader_crash_reopens_once_then_escalates_task(config, db, ledger):
    seen = {}

    def crashy_reader(spec, call, on_fetch):
        t = call("get_task")
        if "Pricing" in t["title"]:
            seen[spec.run_id] = t["task_id"]
            return RunResult(status="timeout", error="killed")
        call("post_note", claim=f"{t['title']}: fact", url="https://e.example/x", quote="The fact is stated.", source_date="2026-01-01", claim_type="other")
        call("finish_task", summary="ok")

    def synth(spec, call, on_fetch):
        tasks = call("list_tasks")
        unanswered = [t["title"] for t in tasks if t["status"] == "escalated"]
        claims = call("list_claims")
        call("submit_deliverable", body="\n".join(f"- {c['claim']} [{c['id']}]" for c in claims), unanswered=unanswered, disagreements="")

    sup, runner = make(config, db, {("reader", "read"): crashy_reader, ("synthesizer", "synthesize"): synth})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    pricing = [t for t in ledger.list_tasks(pid) if "Pricing" in t["title"]][0]
    assert pricing["status"] == "escalated" and pricing["lease_count"] == 2
    assert len(seen) == 2
    assert ledger.latest_deliverable(pid)["unanswered"] == ["Pricing model"]
    assert "Unanswered must-answer items" in ledger.list_replies()[0]["body"]


def test_plan_fallback_when_lead_posts_nothing(config, db, ledger):
    sup, runner = make(config, db, {("lead", "plan"): lambda spec, call, on_fetch: (call("get_problem"), None)[1]})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    tasks = ledger.list_tasks(pid)
    assert [t["title"] for t in tasks] == ["Vendors", "Pricing model", "Named customers"]
    assert any(e["kind"] == "plan_fallback" for e in ledger.events(pid))


def test_unverified_notes_are_dropped_not_trusted(config, db, ledger):
    sup, runner = make(config, db, {("critic", "verify"): lambda spec, call, on_fetch: None})
    pid = post(ledger)
    assert sup.run_problem(pid) == "escalated"
    assert "no note survived verification" in ledger.list_escalations()[0]["reason"]
    assert all(n["status"] == "rejected" for n in ledger.list_notes(pid))


def test_ideas_mode_blind_divergence_premortem_repair(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger, mode="ideas")
    assert sup.run_problem(pid) == "passed"
    stages = [(s.role, s.stage) for s in runner.calls]
    assert stages[:3] == [("thinker", "diverge")] * 3
    assert stages[3] == ("critic", "premortem")
    assert stages[4:7] == [("thinker", "repair")] * 3
    assert stages[7:] == [("synthesizer", "synthesize"), ("judge", "judge")]
    opts = ledger.list_options(pid)
    assert len(opts) == 6 and all(o["premortem"] for o in opts)
    assert sum(o["status"] == "withdrawn" for o in opts) == 3 and sum(o["status"] == "repaired" for o in opts) == 3
    assert "Ranked options" in ledger.list_replies()[0]["body"]


def test_concurrency_never_exceeds_three(config, db, ledger):
    import threading
    import time

    live = {"n": 0, "max": 0}
    lock = threading.Lock()

    def slow_reader(spec, call, on_fetch):
        with lock:
            live["n"] += 1
            live["max"] = max(live["max"], live["n"])
        time.sleep(0.05)
        t = call("get_task")
        call("post_note", claim=f"{t['title']} fact", url="https://e.example/", quote="The quote is here.", source_date=None, claim_type="other")
        call("finish_task", summary="ok")
        with lock:
            live["n"] -= 1

    sup, runner = make(config, db, {("reader", "read"): slow_reader})
    pid = post(ledger, must_answer=["a", "b", "c", "d", "e", "f", "g"])
    assert sup.run_problem(pid) == "passed"
    assert live["max"] <= 3 and [s.role for s in runner.calls].count("reader") == 7


def test_recover_marks_dead_runs_and_requeues(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger)
    ledger.set_status(pid, "working", stage="plan")
    tid = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    rid = ledger.start_run(pid, role="reader", model="haiku", task_id=tid)
    ledger.lease_task(tid, rid)
    sup.recover()
    assert ledger.get_task(tid)["status"] == "open"
    assert ledger.list_runs(pid)[0]["status"] == "error"
    assert ledger.get_problem(pid)["status"] == "queued"


def test_run_window(config, db):
    sup, _ = make(config, db)
    config.run_window = "22:00-07:00"
    assert sup.in_run_window(datetime(2026, 1, 1, 23, 0))
    assert sup.in_run_window(datetime(2026, 1, 1, 3, 0))
    assert not sup.in_run_window(datetime(2026, 1, 1, 12, 0))
    config.run_window = "09:00-17:00"
    assert sup.in_run_window(datetime(2026, 1, 1, 12, 0)) and not sup.in_run_window(datetime(2026, 1, 1, 3, 0))
