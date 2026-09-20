from __future__ import annotations

import json
from typing import Callable

import pytest

from thinktank.config import Config
from thinktank.db import init_db
from thinktank.ledger import Ledger, Usage
from thinktank.mcp_server import Context, call_tool
from thinktank.runner import RunResult, RunSpec
from thinktank.verify import Fetched


@pytest.fixture
def config(tmp_path):
    return Config(db_path=str(tmp_path / "t.sqlite3"), rate_limit_pause_seconds=1, lease_seconds=60,
                  agent_dir=str(tmp_path / "agents"))


# A stand-in for the web: every page carries the quotes the default crew posts.
PAGE_TEXT = "<html><body><p>Sample page. Fact one is stated here. The fact is stated. The quote is here. Costs 10k per seat.</p></body></html>"


def fake_fetcher(pages: dict[str, Fetched] | None = None):
    pages = pages or {}

    def fetch(url: str) -> Fetched:
        if url in pages:
            return pages[url]
        from thinktank.verify import html_to_text
        return Fetched(ok=True, text=html_to_text(PAGE_TEXT), content_type="text/html", status=200)
    return fetch


@pytest.fixture
def db(config):
    init_db(config.db_path)
    return config.db_path


@pytest.fixture
def ledger(db, config):
    L = Ledger(db, config)
    yield L
    L.close()


def post(L: Ledger, mode="research", **over) -> str:
    fields = dict(
        mode=mode,
        question="Which vendors sell AI schedule optimisation to European broadcasters?",
        decision="Whether to position against them at the next trade show",
        must_answer=["Vendors", "Pricing model", "Named customers"],
        evidence_standard="Primary sources, no older than 12 months",
        deliverable="2-page brief plus a comparison table",
        token_cap=1_000_000,
        deadline="2999-01-01T07:00:00+00:00",
    )
    fields.update(over)
    return L.post_problem(**fields)


class FakeRunner:
    """Plays each role by calling the same ledger tools a real agent would
    reach through MCP. ``behaviours`` maps (role, stage) to a function
    (spec, call) -> RunResult | None."""

    def __init__(self, db_path: str, config: Config, behaviours: dict[tuple[str, str], Callable] | None = None,
                 tokens_per_run: int = 1000):
        self.db_path = db_path
        self.config = config
        self.behaviours = behaviours or {}
        self.tokens_per_run = tokens_per_run
        self.calls: list[RunSpec] = []

    def run(self, spec: RunSpec, on_fetch=None) -> RunResult:
        self.calls.append(spec)
        L = Ledger(self.db_path, self.config)
        ctx = Context(role=spec.role, problem_id=spec.problem_id, run_id=spec.run_id, task_id=spec.task_id,
                      slot=spec.slot, round_no=spec.round_no, agent_id=spec.agent_id)

        def call(name: str, **args):
            result, is_error = call_tool(L, ctx, name, args)
            if is_error:
                raise AssertionError(f"{spec.role}/{spec.stage} {name}: {result}")
            return result

        try:
            fn = self.behaviours.get((spec.role, spec.stage)) or DEFAULTS.get((spec.role, spec.stage)) or DEFAULTS[(spec.role, "wake")]
            res = fn(spec, call, on_fetch)
        finally:
            L.close()
        if res is None:
            res = RunResult(status="ok")
        if res.status == "ok" and not res.session_id:
            res.session_id = spec.session_id
        if res.usage.total == 0:
            res.usage = Usage(input_tokens=self.tokens_per_run, output_tokens=0, cost_usd=self.tokens_per_run / 1e6 * 5)
        return res


# --------------------------------------------------------------- default behaviours (a well-behaved crew)
def lead_plan(spec, call, on_fetch):
    p = call("get_problem")
    call("search_claims", query=p["question"])
    n = len(p["must_answer"])
    slice_tokens = int(p["token_cap"] * 0.5 / n) if p["token_cap"] else 200_000
    for item in p["must_answer"]:
        call("post_subtask", title=item, criteria=f"answer {item} with dated sources", budget_tokens=slice_tokens)
    call("list_tasks")


def reader_read(spec, call, on_fetch):
    t = call("get_task")
    if on_fetch:
        on_fetch("search", t["title"])
        on_fetch("fetch", "https://example.com/" + t["title"].lower().replace(" ", "-"))
    call("post_note", claim=f"{t['title']}: fact one", url="https://example.com/" + t["title"].lower().replace(" ", "-"),
         quote="fact one is stated here", source_date="2026-05-01", claim_type="company_fact")
    call("finish_task", summary=f"found one fact about {t['title']}")


def critic_verify(spec, call, on_fetch):
    for n in call("list_notes", status="unverified"):
        if on_fetch:
            on_fetch("fetch", n["url"])
        call("verify_note", note_id=n["id"], verified=True, reason="quote and date found", tags="broadcast,ai")


def synthesizer_synthesize(spec, call, on_fetch):
    p = call("get_problem")
    claims = call("list_claims")
    body = "# Brief\n\n" + "\n".join(f"- {c['claim']} [{c['id']}]" for c in claims)
    if p["mode"] == "ideas":
        opts = [o for o in call("list_options") if o["status"] != "withdrawn"]
        body = "# Ranked options\n\n" + "\n".join(f"{i + 1}. {o['title']}" for i, o in enumerate(opts))
    call("submit_deliverable", body=body, unanswered=[], disagreements="")


def critic_critique(spec, call, on_fetch):
    d = call("get_deliverable")
    call("post_critique", deliverable_id=d["id"], body="stands", objections=[])


def judge_judge(spec, call, on_fetch):
    d = call("get_deliverable")
    call("get_brief")
    call("submit_verdict", deliverable_id=d["id"], passed=True, reasons="all items covered")


def thinker_diverge(spec, call, on_fetch):
    for i in range(2):
        call("post_option", title=f"Option {spec.slot}-{i}", body="what, who, cost, assumption")


def critic_premortem(spec, call, on_fetch):
    for o in call("list_options"):
        call("post_premortem", option_id=o["id"], body="it failed because the assumption broke")


def thinker_repair(spec, call, on_fetch):
    mine = call("list_my_options")
    call("repair_option", option_id=mine[0]["id"], body="repaired: assumption now hedged")
    if len(mine) > 1:
        call("withdraw_option", option_id=mine[1]["id"], reason="premortem is right")


def wake_default(spec, call, on_fetch):
    """A well-behaved wake: read the inbox, answer questions in their thread, ignore the rest."""
    for m in call("read_inbox"):
        if m["kind"] == "question":
            call("post_message", kind="answer", body=f"Answer to: {m['body'][:60]}", to=m["from"], thread_id=m["thread_id"])


DEFAULTS = {
    ("reader", "wake"): wake_default,
    ("lead", "wake"): wake_default,
    ("thinker", "wake"): wake_default,
    ("critic", "wake"): wake_default,
    ("lead", "plan"): lead_plan,
    ("reader", "read"): reader_read,
    ("critic", "verify"): critic_verify,
    ("synthesizer", "synthesize"): synthesizer_synthesize,
    ("synthesizer", "revise"): synthesizer_synthesize,
    ("critic", "critique"): critic_critique,
    ("judge", "judge"): judge_judge,
    ("thinker", "diverge"): thinker_diverge,
    ("critic", "premortem"): critic_premortem,
    ("thinker", "repair"): thinker_repair,
}


def dumps(o) -> str:
    return json.dumps(o, default=str)
