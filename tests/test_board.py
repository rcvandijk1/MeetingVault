"""Agent index, message board routing, thread budgets, and the interleaved
event loop: wakes resume the same agent session."""
import pytest

from thinktank.ledger import LedgerError
from thinktank.mcp_server import Context, call_tool
from thinktank.runner import RunResult
from thinktank.supervisor import Supervisor

from conftest import FakeRunner, fake_fetcher, post


def make(config, db, behaviours=None, pages=None, **kw):
    runner = FakeRunner(db, config, behaviours, **kw)
    return Supervisor(config, db, runner, fetcher=fake_fetcher(pages)), runner


def open_board(ledger, pid, stage="read"):
    ledger.conn.execute("UPDATE problems SET status='working', stage_now=? WHERE id=?", (stage, pid))


# --------------------------------------------------------------- index
def test_registry_birth_and_self_registration(ledger):
    pid = post(ledger)
    a = ledger.born(pid, role="reader", name="reader-pricing", session_id="s1", workdir="/tmp/x", model="haiku", topics=["pricing"])
    ledger.born(pid, role="reader", name="reader-vendors", session_id="s2", workdir="/tmp/y", model="haiku")
    me = ledger.get_agent(a)
    assert me["topics"] == ["pricing"] and me["registered"] == 0
    ctx = Context(role="reader", problem_id=pid, run_id="r1", agent_id=a)
    result, err = call_tool(ledger, ctx, "register_self", {"topics": ["Pricing", "licence fees", "EU broadcasters"], "brief": "I cover pricing"})
    assert not err and result["registered"] == 1 and result["topics"] == ["pricing", "licence fees", "eu broadcasters"]
    with pytest.raises(LedgerError, match="at least one topic"):
        ledger.register_self(a, topics=[], brief="x")
    names = [x["name"] for x in ledger.list_agents(pid)]
    assert names == ["reader-pricing", "reader-vendors"]
    assert ledger.find_agent(pid, "reader-vendors")["id"] != a and ledger.find_agent(pid, a)["id"] == a


# --------------------------------------------------------------- routing rules
def test_addressed_and_topic_routing(ledger, config):
    pid = post(ledger)
    open_board(ledger, pid)
    r1 = ledger.born(pid, role="reader", name="r1", session_id="s", workdir="w", model="m", topics=["pricing", "vendors"])
    r2 = ledger.born(pid, role="reader", name="r2", session_id="s", workdir="w", model="m", topics=["customers"])
    r3 = ledger.born(pid, role="reader", name="r3", session_id="s", workdir="w", model="m", topics=["pricing"])
    r4 = ledger.born(pid, role="reader", name="r4", session_id="s", workdir="w", model="m", topics=["pricing models"])
    lead = ledger.born(pid, role="lead", name="lead", session_id="s", workdir="w", model="m", topics=["broadcast", "pricing"])
    # addressed
    m = ledger.post_message(pid, from_agent=r2, kind="question", body="Who sells to RTL?", to_agent="lead")
    assert m["recipients"] == ["lead"] and m["routing"].startswith("addressed")
    # topic: at most max_topic_matches, sender excluded, substring overlap counts
    m = ledger.post_message(pid, from_agent=r2, kind="finding", body="pricing is per channel", topics=["pricing"])
    assert len(m["recipients"]) == config.max_topic_matches and "r2" not in m["recipients"]
    assert set(m["recipients"]) <= {"r1", "r3", "r4"}  # the lead has "pricing" too but is addressable only
    # no match is recorded, not an error
    m = ledger.post_message(pid, from_agent=r1, kind="finding", body="nothing overlaps", topics=["zzz"])
    assert m["recipients"] == [] and "no match" in m["routing"]
    # rules
    with pytest.raises(LedgerError, match="address the message"):
        ledger.post_message(pid, from_agent=r1, kind="finding", body="x")
    with pytest.raises(LedgerError, match="yourself"):
        ledger.post_message(pid, from_agent=r1, kind="finding", body="x", to_agent="r1")
    with pytest.raises(LedgerError, match="no alive agent"):
        ledger.post_message(pid, from_agent=r1, kind="finding", body="x", to_agent="ghost")
    with pytest.raises(LedgerError, match="kind must be"):
        ledger.post_message(pid, from_agent=r1, kind="rant", body="x", to_agent="lead")
    with pytest.raises(LedgerError, match="longer than 3000"):
        ledger.post_message(pid, from_agent=r1, kind="finding", body="x" * 3001, to_agent="lead")
    synth = ledger.born(pid, role="synthesizer", name="synthesizer", session_id="s", workdir="w", model="m")
    with pytest.raises(LedgerError, match="may not address"):
        ledger.post_message(pid, from_agent=r1, kind="finding", body="x", to_agent="synthesizer")
    with pytest.raises(LedgerError, match="may not address"):
        ledger.post_message(pid, from_agent=synth, kind="finding", body="x", to_agent="lead")
    # pickups
    pend = {p["agent_id"]: p["count"] for p in ledger.pending_pickups(pid)}
    assert pend[lead] == 1 and sum(pend.values()) == 3


def test_board_closed_outside_working_stages(ledger):
    pid = post(ledger, mode="ideas")
    t1 = ledger.born(pid, role="thinker", name="thinker-1", session_id="s", workdir="w", model="m", slot=0, topics=["x"])
    ledger.born(pid, role="thinker", name="thinker-2", session_id="s", workdir="w", model="m", slot=1, topics=["x"])
    open_board(ledger, pid, "diverge")
    with pytest.raises(LedgerError, match="closed in this stage"):
        ledger.post_message(pid, from_agent=t1, kind="finding", body="peek", to_agent="thinker-2")
    open_board(ledger, pid, "repair")
    assert ledger.post_message(pid, from_agent=t1, kind="finding", body="combine?", to_agent="thinker-2")["recipients"] == ["thinker-2"]
    open_board(ledger, pid, "synthesize")
    with pytest.raises(LedgerError, match="closed in this stage"):
        ledger.post_message(pid, from_agent=t1, kind="finding", body="late", to_agent="thinker-2")


def test_thread_budget_and_settlement(ledger, config):
    config.thread_token_budget = 1000
    pid = post(ledger)
    open_board(ledger, pid)
    a = ledger.born(pid, role="reader", name="a", session_id="s", workdir="w", model="m", topics=["t"])
    b = ledger.born(pid, role="reader", name="b", session_id="s", workdir="w", model="m", topics=["t"])
    m1 = ledger.post_message(pid, from_agent=a, kind="question", body="q?", to_agent="b")
    tid = m1["thread_id"]
    inbox = ledger.inbox(b)
    assert len(inbox) == 1 and inbox[0]["thread"] == [] and inbox[0]["from_name"] == "a"
    assert ledger.inbox(b) == []  # delivered once
    m2 = ledger.post_message(pid, from_agent=b, kind="answer", body="a.", to_agent="a", thread_id=tid)
    assert m2["thread_id"] == tid
    assert ledger.inbox(a)[0]["thread"] == [{"from": "a", "kind": "question", "body": "q?"}]
    waiting = ledger.pickups_waiting(a)
    served = ledger.settle_pickups(a, waiting)
    assert served == [tid] and ledger.pending_pickups(pid) == []
    # a message that arrives during a wake is not settled by it
    late = ledger.post_message(pid, from_agent=b, kind="question", body="late?", to_agent="a")
    assert ledger.settle_pickups(a, []) == [] and ledger.pending_pickups(pid) == [{"agent_id": a, "count": 1}]
    ledger.settle_pickups(a, ledger.pickups_waiting(a))
    assert ledger.pending_pickups(pid) == [] and late["thread_id"] != tid
    assert ledger.charge_threads([tid, tid], 600) == [] and ledger.get_thread(tid)["tokens_used"] == 600
    assert ledger.charge_threads([tid], 500) == [tid]
    th = ledger.get_thread(tid)
    assert th["status"] == "closed" and "budget spent" in th["closed_reason"]
    with pytest.raises(LedgerError, match="is closed"):
        ledger.post_message(pid, from_agent=a, kind="answer", body="more", to_agent="b", thread_id=tid)
    ledger.link_artefact(tid, "n_123")
    assert ledger.get_thread(tid)["artefacts"] == ["n_123"]


def test_an_answer_that_asks_nothing_wakes_nobody_who_was_not_waiting(ledger, config):
    pid = post(ledger)
    open_board(ledger, pid)
    a = ledger.born(pid, role="reader", name="a", session_id="s", workdir="w", model="m", topics=["t"])
    b = ledger.born(pid, role="reader", name="b", session_id="s", workdir="w", model="m", topics=["t"])
    tid = ledger.post_message(pid, from_agent=a, kind="question", body="Which page?", to_agent="b")["thread_id"]
    ledger.settle_pickups(b, ledger.pickups_waiting(b))
    # b answers: a asked, so a is woken
    m = ledger.post_message(pid, from_agent=b, kind="answer", body="Page 3.", to_agent="a", thread_id=tid)
    assert m["recipients"] == ["a"] and ledger.pending_pickups(pid) == [{"agent_id": a, "count": 1}]
    ledger.settle_pickups(a, ledger.pickups_waiting(a))
    # a says thanks: b's last word was an answer, so nothing is created
    m = ledger.post_message(pid, from_agent=a, kind="answer", body="Noted, thanks.", to_agent="b", thread_id=tid)
    assert m["recipients"] == ["b"] and "no pickup" in m["routing"] and ledger.pending_pickups(pid) == []
    # but a follow-up question inside an answer still wakes
    m = ledger.post_message(pid, from_agent=a, kind="answer", body="Noted. Is that the 2026 edition?", to_agent="b", thread_id=tid)
    assert "no pickup" not in m["routing"] and ledger.pending_pickups(pid) == [{"agent_id": b, "count": 1}]
    # the thread still records every message
    assert [x["kind"] for x in ledger.thread_messages(tid)] == ["question", "answer", "answer", "answer"]
    # an answer that opens a new thread to someone who asked nothing wakes nobody
    m = ledger.post_message(pid, from_agent=b, kind="answer", body="FYI, done.", to_agent="a")
    assert "no pickup" in m["routing"]


# --------------------------------------------------------------- the event loop
def test_question_wakes_recipient_and_the_answer_wakes_the_asker(config, db, ledger):
    def curious_reader(spec, call, on_fetch):
        t = call("get_task")
        call("register_self", topics=[t["title"].lower()], brief=f"I cover {t['title']}")
        call("post_note", claim=f"{t['title']}: fact one", url="https://example.com/x", quote="Fact one is stated here.", source_date="2026-05-01", claim_type="other")
        if "Vendors" in t["title"]:
            call("post_message", kind="question", body="Does the pricing reader know per-seat fees?", topics=["pricing model"])
        call("finish_task", summary="done")

    sup, runner = make(config, db, {("reader", "read"): curious_reader})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    # The question overlaps the pricing reader (the lead also carries
    # "pricing" but is addressable only); the pricing reader is woken and
    # answers; the asker is woken to read the answer; the critic's wake is
    # its deliverable critique.
    wakes = [s for s in runner.calls if s.stage == "wake"]
    assert [s.role for s in wakes] == ["reader", "reader"]
    agents = {a["name"]: a for a in ledger.list_agents(pid, alive_only=False)}
    pricing, vendors, lead = agents["reader-pricing-model"], agents["reader-vendors"], agents["lead"]
    assert wakes[0].agent_id == pricing["id"] and wakes[0].session_id == pricing["session_id"] and wakes[0].workdir == pricing["workdir"]
    assert wakes[0].resume and wakes[1].resume and wakes[1].agent_id == vendors["id"]
    threads = ledger.list_threads(pid)
    assert len(threads) == 1 and [m["kind"] for m in threads[0]["messages"]] == ["question", "answer"]
    assert threads[0]["messages"][0]["routing"] == "topics pricing model -> reader-pricing-model"
    assert threads[0]["status"] == "closed" and threads[0]["closed_reason"] == "problem closed"
    assert pricing["wakes"] == 1 and vendors["wakes"] == 1 and lead["wakes"] == 0 and pricing["status"] == "retired"
    assert ledger.pending_pickups(pid) == []
    assert "Message board (1 threads, 2 messages" in ledger.list_replies()[0]["body"]


def test_finding_to_lead_makes_lead_split_a_new_subtask(config, db, ledger):
    def reader(spec, call, on_fetch):
        t = call("get_task")
        call("post_note", claim=f"{t['title']}: fact one", url="https://example.com/x", quote="Fact one is stated here.", source_date="2026-05-01", claim_type="other")
        if "Vendors" in t["title"]:
            call("post_message", kind="finding", body="Vendor X was acquired by Y last month; nobody covers Y.", to="lead")
        call("finish_task", summary="done")

    def lead_wake(spec, call, on_fetch):
        for m in call("read_inbox"):
            if "acquired" in m["body"]:
                call("post_subtask", title="Acquirer Y's product line", criteria="what Y sells", budget_tokens=50_000)
                call("post_message", kind="answer", body="Split off a subtask for Y.", to=m["from"], thread_id=m["thread_id"])

    sup, runner = make(config, db, {("reader", "read"): reader, ("lead", "wake"): lead_wake})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    titles = [t["title"] for t in ledger.list_tasks(pid)]
    assert "Acquirer Y's product line" in titles and all(t["status"] == "done" for t in ledger.list_tasks(pid))
    assert [s.role for s in runner.calls if s.stage == "wake"] == ["lead", "reader"]
    assert len([s for s in runner.calls if s.role == "reader" and not s.resume]) == 4


def test_critic_objection_wakes_reader_who_posts_a_better_note(config, db, ledger):
    state = {"critic_runs": 0}

    def critic(spec, call, on_fetch):
        state["critic_runs"] += 1
        call("register_self", topics=["verification"], brief="critic")
        for n in call("list_notes", status="unverified"):
            if "Pricing" in n["claim"] and "better" not in n["claim"]:
                call("verify_note", note_id=n["id"], verified=False, reason="date on page is 2024, too old")
                call("post_message", kind="objection", body="Your source is from 2024; find a current one.", to="reader-pricing-model", refs=[n["id"]])
            else:
                call("verify_note", note_id=n["id"], verified=True, reason="ok")

    def reader_wake(spec, call, on_fetch):
        for m in call("read_inbox"):
            if m["kind"] == "objection":
                call("post_note", claim="Pricing model: better fact", url="https://example.com/pricing-2026", quote="Fact one is stated here.", source_date="2026-06-01", claim_type="price")
                call("post_message", kind="answer", body="Posted a 2026 source.", to=m["from"], thread_id=m["thread_id"])

    sup, runner = make(config, db, {("critic", "verify"): critic, ("reader", "wake"): reader_wake})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    assert state["critic_runs"] == 2
    critic_runs = [s for s in runner.calls if s.role == "critic" and s.stage == "verify"]
    assert [s.resume for s in critic_runs] == [False, True]  # same critic, woken for round 2
    claims = {c["claim"] for c in ledger.claims_for_problem(pid)}
    assert "Pricing model: better fact" in claims and "Pricing model: fact one" not in claims
    th = ledger.list_threads(pid)[0]
    assert [m["kind"] for m in th["messages"]] == ["objection", "answer"]


def test_ping_pong_stops_when_the_thread_budget_is_spent(config, db, ledger):
    config.thread_token_budget = 2500  # 1000 tokens per fake run

    def reader(spec, call, on_fetch):
        t = call("get_task")
        call("register_self", topics=[t["title"].lower()], brief="")
        call("post_note", claim=f"{t['title']}: fact one", url="https://example.com/x", quote="Fact one is stated here.", source_date="2026-05-01", claim_type="other")
        if "Vendors" in t["title"]:
            call("post_message", kind="question", body="round 0", topics=["pricing model"])
        call("finish_task", summary="done")

    def argumentative(spec, call, on_fetch):
        for m in call("read_inbox"):
            call("post_message", kind="answer", body="and again?", to=m["from"], thread_id=m["thread_id"])

    sup, runner = make(config, db, {("reader", "read"): reader, ("reader", "wake"): argumentative})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    th = ledger.list_threads(pid)[0]
    assert th["status"] == "closed" and "budget spent" in th["closed_reason"]
    wakes = [s for s in runner.calls if s.resume]
    assert 2 <= len(wakes) <= 4
    assert ledger.pending_pickups(pid) == []


def test_ideas_thinkers_combine_after_premortem_but_not_during_divergence(config, db, ledger):
    def diverge(spec, call, on_fetch):
        call("register_self", topics=["pricing", f"slot{spec.slot}"], brief="thinker")
        call("post_option", title=f"Option {spec.slot}", body="what, who, cost, assumption")
        from thinktank.ledger import Ledger
        L = Ledger(config.db_path, config)
        ctx = Context(role="thinker", problem_id=spec.problem_id, run_id=spec.run_id, slot=spec.slot, agent_id=spec.agent_id)
        result, err = call_tool(L, ctx, "post_message", {"kind": "finding", "body": "peek", "topics": ["pricing"]})
        L.close()
        assert err and "closed in this stage" in result

    def repair(spec, call, on_fetch):
        mine = call("list_my_options")
        call("repair_option", option_id=mine[0]["id"], body="repaired")
        if spec.slot == 0:
            call("post_message", kind="request", body="Combine my option with yours?", topics=["pricing"], refs=[mine[0]["id"]])
            call("post_message", kind="objection", body="Your premortem assumes no budget.", to="critic")

    def thinker_wake(spec, call, on_fetch):
        for m in call("read_inbox"):
            if m["kind"] != "answer":
                call("post_message", kind="answer", body="Yes, combined.", to=m["from"], thread_id=m["thread_id"])

    def critic_wake(spec, call, on_fetch):
        for m in call("read_inbox"):
            if m["kind"] != "answer":
                call("post_message", kind="answer", body="Budget is exactly the risk.", to=m["from"], thread_id=m["thread_id"])

    sup, runner = make(config, db, {("thinker", "diverge"): diverge, ("thinker", "repair"): repair,
                                    ("thinker", "wake"): thinker_wake, ("critic", "wake"): critic_wake})
    pid = post(ledger, mode="ideas")
    assert sup.run_problem(pid) == "passed"
    repairs = [s for s in runner.calls if s.stage == "repair"]
    assert all(s.resume for s in repairs) and len(repairs) == 3  # same thinkers, woken with their premortems
    threads = ledger.list_threads(pid)
    kinds = sorted(tuple(m["kind"] for m in t["messages"]) for t in threads)
    assert kinds == [("objection", "answer"), ("request", "answer", "answer")]
    wake_roles = sorted(s.role for s in runner.calls if s.stage == "wake")
    assert wake_roles == ["critic", "thinker", "thinker", "thinker"]


def test_rate_limited_first_run_respawns_instead_of_resuming(config, db, ledger):
    hits = {"n": 0}

    def flaky(spec, call, on_fetch):
        hits["n"] += 1
        if hits["n"] == 1:
            return RunResult(status="rate_limited", error="usage limit reached")
        for n in call("list_notes", status="unverified"):
            call("verify_note", note_id=n["id"], verified=True, reason="ok")

    sup, runner = make(config, db, {("critic", "verify"): flaky})
    pid = post(ledger)
    assert sup.run_problem(pid) == "queued"
    assert sup.run_problem(pid) == "passed"
    critic_runs = [s for s in runner.calls if s.role == "critic" and s.stage == "verify"]
    assert [s.resume for s in critic_runs] == [False, False]
    assert len({s.session_id for s in critic_runs}) == 1
    assert len([a for a in ledger.list_agents(pid, alive_only=False) if a["role"] == "critic"]) == 1


def test_retire_deletes_agents_with_the_problem(config, db, ledger, tmp_path):
    deleted = []

    class Recording(FakeRunner):
        def delete_agent(self, workdir, session_id):
            deleted.append((workdir, session_id))

    runner = Recording(db, config)
    sup = Supervisor(config, db, runner, fetcher=fake_fetcher())
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    agents = ledger.list_agents(pid, alive_only=False)
    assert agents and all(a["status"] == "retired" for a in agents) and ledger.list_agents(pid) == []
    assert sorted(deleted) == sorted((a["workdir"], a["session_id"]) for a in agents)
    assert all(a["workdir"].startswith(config.agent_dir) for a in agents)
