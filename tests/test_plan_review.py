"""Plan review before reading, hypotheses that must be attacked, model
fallback and effort per role."""
import pytest

from thinktank.config import Config
from thinktank.ledger import LedgerError
from thinktank.runner import ClaudeCodeRunner, RunSpec
from thinktank.supervisor import Supervisor

from conftest import FakeRunner, fake_fetcher, post


def make(config, db, behaviours=None, pages=None, **kw):
    runner = FakeRunner(db, config, behaviours, **kw)
    return Supervisor(config, db, runner, fetcher=fake_fetcher(pages)), runner


def test_plan_review_runs_before_reading_and_the_critic_is_the_same_agent_later(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    stages = [(s.role, s.stage) for s in runner.calls]
    assert stages[0] == ("lead", "plan") and stages[1] == ("critic", "plan_review")
    assert stages[2] == ("reader", "read")
    critic_runs = [s for s in runner.calls if s.role == "critic"]
    assert [s.stage for s in critic_runs] == ["plan_review", "verify", "critique"]
    assert [s.resume for s in critic_runs] == [False, True, True]  # one critic, woken for each later stage
    assert len({s.session_id for s in critic_runs}) == 1
    review = ledger.list_critiques(pid, "plan")
    assert len(review) == 1 and review[0]["objections"] == []
    assert any(e["kind"] == "plan_review_ok" for e in ledger.events(pid))


def test_objections_wake_the_lead_who_cancels_and_adds_before_readers_start(config, db, ledger):
    def review(spec, call, on_fetch):
        tasks = call("list_tasks")
        dup = [t for t in tasks if t["title"] == "Named customers"][0]
        call("review_plan", body="one unanswerable, one missing", objections=[
            {"task_id": dup["id"], "objection": "Customer names are not public for these vendors; drop it or narrow to press releases"},
            {"must_answer_item": "Pricing model", "objection": "No subtask asks for list prices from vendor sites"},
        ])

    def revise(spec, call, on_fetch):
        crits = call("list_critiques")
        assert crits and crits[0]["target_kind"] == "plan"
        for ob in crits[0]["objections"]:
            if ob["task_id"]:
                call("cancel_subtask", task_id=ob["task_id"], reason="not public")
            else:
                call("post_subtask", title="List prices from vendor sites", criteria="a dated price page per vendor", budget_tokens=50_000)
        call("list_tasks")

    sup, runner = make(config, db, {("critic", "plan_review"): review, ("lead", "plan_revise"): revise})
    pid = post(ledger)
    assert sup.run_problem(pid) == "passed"
    stages = [(s.role, s.stage, s.resume) for s in runner.calls]
    assert stages[:3] == [("lead", "plan", False), ("critic", "plan_review", False), ("lead", "plan_revise", True)]
    tasks = {t["title"]: t for t in ledger.list_tasks(pid)}
    assert tasks["Named customers"]["status"] == "cancelled" and "not public" in tasks["Named customers"]["summary"]
    assert tasks["List prices from vendor sites"]["status"] == "done"
    readers = [s for s in runner.calls if s.role == "reader" and not s.resume]
    assert len(readers) == 3  # Vendors, Pricing model, the new one; not the cancelled one
    assert any(e["kind"] == "plan_revised" for e in ledger.events(pid))


def test_plan_review_is_one_round_and_cancel_has_rules(ledger):
    pid = post(ledger)
    t1 = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    t2 = ledger.create_task(pid, title="b", criteria="c", budget_tokens=10, merge_owner="lead")
    with pytest.raises(LedgerError, match="claim_id, a must_answer_item, a hypothesis or a task_id"):
        ledger.post_plan_review(pid, body="x", objections=[{"objection": "vague"}], run_id=None)
    ledger.post_plan_review(pid, body="x", objections=[{"task_id": t1, "objection": "too broad"}], run_id=None)
    with pytest.raises(LedgerError, match="one review round"):
        ledger.post_plan_review(pid, body="again", objections=[], run_id=None)
    ledger.post_note(pid, task_id=t2, run_id=None, claim="c", url="https://x.example/", quote="a full supporting sentence", source_date=None)
    with pytest.raises(LedgerError, match="notes cannot be cancelled"):
        ledger.cancel_task(t2, "nope", by="lead")
    ledger.lease_task(t1, "r")
    with pytest.raises(LedgerError, match="only open tasks"):
        ledger.cancel_task(t1, "nope", by="lead")
    t3 = ledger.create_task(pid, title="c", criteria="c", budget_tokens=10, merge_owner="lead")
    ledger.cancel_task(t3, "duplicate", by="lead")
    assert ledger.get_task(t3)["status"] == "cancelled"


def test_hypotheses_flow_from_post_to_brief_prompts_and_reply(config, db, ledger):
    seen = {}

    def synth(spec, call, on_fetch):
        p = call("get_problem")
        seen["hyps"] = p["hypotheses"]
        claims = call("list_claims")
        body = "# Brief\n\n" + "\n".join(f"- {c['claim']} [{c['id']}]" for c in claims) + "\n\n## Hypotheses\n- H1: contradicted [" + claims[0]["id"] + "]"
        call("submit_deliverable", body=body, unanswered=[], disagreements="")

    def critique(spec, call, on_fetch):
        d = call("get_deliverable")
        call("post_critique", deliverable_id=d["id"], body="hyp check", objections=[{"hypothesis": "Vendor X dominates", "objection": "verdict rests on one claim"}])

    def judge(spec, call, on_fetch):
        b = call("get_brief")
        seen["brief_hyps"] = b["hypotheses"]
        d = call("get_deliverable")
        call("submit_verdict", deliverable_id=d["id"], passed=True, reasons="H1 has a verdict")

    sup, runner = make(config, db, {("synthesizer", "synthesize"): synth, ("critic", "critique"): critique, ("judge", "judge"): judge})
    pid = post(ledger, hypotheses=["Vendor X dominates", " "])
    assert ledger.get_problem(pid)["hypotheses"] == ["Vendor X dominates"]
    assert sup.run_problem(pid) == "passed"
    assert seen["hyps"] == ["Vendor X dominates"] and seen["brief_hyps"] == ["Vendor X dominates"]
    lead_prompt = [s for s in runner.calls if s.role == "lead"][0].user_prompt
    assert "H1. Vendor X dominates" in lead_prompt and "evidence against" in lead_prompt
    assert [s.stage for s in runner.calls].count("revise") == 1  # the hypothesis objection triggered a revision
    body = ledger.list_replies()[0]["body"]
    assert "## Hypotheses tested" in body and "H1. Vendor X dominates" in body
    with pytest.raises(LedgerError, match="unknown hypothesis"):
        ledger.post_critique(pid, deliverable_id=ledger.latest_deliverable(pid)["id"], round_no=2, body="b",
                             objections=[{"hypothesis": "made up", "objection": "x"}], run_id=None)
    with pytest.raises(LedgerError, match="at most 5"):
        post(ledger, hypotheses=list("abcdef"))


def test_models_fallbacks_and_effort_per_role_and_mode():
    cfg = Config()
    assert cfg.model_for("lead") == "fable" and cfg.model_for("synthesizer") == "fable" and cfg.model_for("reader") == "haiku"
    assert cfg.model_for("critic") == "sonnet" and cfg.model_for("critic", "ideas") == "opus"
    assert cfg.fallback_for("lead") == "opus" and cfg.fallback_for("reader") == "sonnet"
    assert cfg.fallback_for("critic", "ideas") is None  # fallback equals the primary: not passed
    assert cfg.effort_for("critic") == "medium" and cfg.effort_for("critic", "ideas") == "high" and cfg.effort_for("lead") == "high"
    cfg.effort["reader"] = ""
    assert cfg.effort_for("reader") is None


def test_runner_passes_fallback_and_effort(tmp_path):
    r = ClaudeCodeRunner(Config(), str(tmp_path / "db"))
    spec = RunSpec(role="lead", stage="plan", problem_id="p", run_id="r", model="fable", system_prompt="s", user_prompt="u",
                   fallback_model="opus", effort="high")
    cmd = r.command(spec)
    assert cmd[cmd.index("--fallback-model") + 1] == "opus" and cmd[cmd.index("--effort") + 1] == "high"
    plain = r.command(RunSpec(role="judge", stage="judge", problem_id="p", run_id="r", model="sonnet", system_prompt="s", user_prompt="u"))
    assert "--fallback-model" not in plain and "--effort" not in plain


def test_supervisor_uses_mode_specific_models(config, db, ledger):
    sup, runner = make(config, db)
    pid = post(ledger, mode="ideas")
    assert sup.run_problem(pid) == "passed"
    critic = [s for s in runner.calls if s.role == "critic"][0]
    assert critic.model == "opus" and critic.effort == "high" and critic.fallback_model is None
    thinker = [s for s in runner.calls if s.role == "thinker"][0]
    assert thinker.model == "fable" and thinker.fallback_model == "opus"
    pid2 = post(ledger)
    sup.run_problem(pid2)
    critic2 = [s for s in runner.calls if s.role == "critic" and s.problem_id == pid2][0]
    assert critic2.model == "sonnet" and critic2.effort == "medium" and critic2.fallback_model == "opus"
