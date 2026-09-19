"""The supervisor: plain code, not an LLM (section 3).

It owns state transitions, leases, budgets and timeouts. Each problem runs
through a fixed list of stages; the stage reached is recorded on the
problem, so a crash, a rate-limit pause or a restart resumes where it
stopped instead of re-spending tokens. A failed judgement escalates; it
never loops back automatically (section 5).
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable

from . import prompts
from .config import Config
from .db import init_db, now_iso
from .governor import Governor
from .ledger import IDEAS, RESEARCH, Ledger, LedgerError, Usage
from .runner import ClaudeCodeRunner, Runner, RunResult, RunSpec

log = logging.getLogger("thinktank")

BUILTIN_TOOLS = {
    "reader": ("WebSearch", "WebFetch"),
    "lead": (),
    "thinker": (),
    "critic_verify": ("WebFetch",),
    "critic": (),
    "synthesizer": (),
    "judge": (),
}


class Stop(Exception):
    """The problem must stop: cap, deadline, or an unrecoverable failure."""


class RateLimited(Exception):
    """A run hit a rate limit; pause and queue, never retry in a tight loop."""


class Supervisor:
    def __init__(self, config: Config, db_path: str | None = None, runner: Runner | None = None):
        self.config = config
        self.db_path = db_path or config.db_path
        init_db(self.db_path)
        self.runner: Runner = runner or ClaudeCodeRunner(config, self.db_path)
        self.ledger = Ledger(self.db_path, config)
        self.governor = Governor(config, self.ledger)

    # ------------------------------------------------------------ public
    def run_problem(self, pid: str) -> str:
        """Drive one problem from its recorded stage to a terminal status.
        Returns the final status: passed, escalated, rejected or queued."""
        L = self.ledger
        p = L.get_problem(pid)
        if p["status"] in ("passed", "escalated", "rejected"):
            return p["status"]
        stages = RESEARCH_STAGES if p["mode"] == RESEARCH else IDEAS_STAGES
        names = [s[0] for s in stages]
        start = names.index(p["stage"]) + 1 if p["stage"] in names else 0
        try:
            for name, fn in stages[start:]:
                self._guard(pid)
                L.set_status(pid, STATUS_FOR_STAGE.get(name, "working"), stage=None)
                log.info("problem %s: stage %s", pid, name)
                fn(self, pid)
                L.conn.execute("UPDATE problems SET stage=?, updated_at=? WHERE id=?", (name, now_iso(), pid))
            return L.get_problem(pid)["status"]
        except RateLimited as e:
            L.defer(pid, self.config.rate_limit_pause_seconds, f"rate limited: {e}")
            return "queued"
        except Stop as e:
            self._escalate(pid, str(e))
            return "escalated"

    def daemon(self, once: bool = False, sleep: Callable[[float], None] = time.sleep) -> None:
        """Poll the inbox board; run problems inside the run window, one at a
        time (concurrency lives inside a problem, capped at 3 agents)."""
        self.recover()
        while True:
            for p in self.ledger.list_problems("posted"):
                self.ledger.set_status(p["id"], "queued")
            ran = False
            if self.in_run_window():
                week = self.governor.week_summary()
                if week["week_tokens"] < self.config.weekly_token_cap:
                    now = now_iso()
                    for p in self.ledger.list_problems("queued"):
                        if p["not_before"] and p["not_before"] > now:
                            continue
                        status = self.run_problem(p["id"])
                        log.info("problem %s -> %s", p["id"], status)
                        ran = True
                        break
                else:
                    log.warning("weekly cap reached (%s); idle", week)
            if once:
                return
            if not ran:
                sleep(self.config.poll_seconds)

    def recover(self) -> None:
        """After a crash: runs left 'running' are dead, their leases are void,
        and problems mid-flight go back to the queue at their recorded stage."""
        L = self.ledger
        dead = L._all("SELECT id, problem_id, task_id FROM runs WHERE status='running'")
        for r in dead:
            L.finish_run(r["id"], status="error", usage=Usage(), error="supervisor restarted while run was active")
            if r["task_id"]:
                try:
                    if L.get_task(r["task_id"])["status"] == "leased":
                        L.release_task(r["task_id"], "supervisor restarted")
                except LedgerError:
                    pass
        for p in L.list_problems():
            if p["status"] not in ("posted", "queued", "passed", "escalated", "rejected"):
                L.set_status(p["id"], "queued")

    def in_run_window(self, now: datetime | None = None) -> bool:
        win = (self.config.run_window or "").strip()
        if not win:
            return True
        start_s, end_s = win.split("-", 1)
        now = now or datetime.now().astimezone()
        cur = now.hour * 60 + now.minute
        sh, sm = (int(x) for x in start_s.split(":"))
        eh, em = (int(x) for x in end_s.split(":"))
        start, end = sh * 60 + sm, eh * 60 + em
        if start <= end:
            return start <= cur < end
        return cur >= start or cur < end

    # ------------------------------------------------------------ spawning
    def _guard(self, pid: str) -> None:
        reason = self.governor.stop_reason(self.ledger.get_problem(pid))
        if reason:
            raise Stop(reason)

    def _run(self, L: Ledger, pid: str, *, role: str, stage: str, system_prompt: str, extra: dict | None = None,
             tools_key: str | None = None, task_id: str | None = None, slot: int | None = None, round_no: int = 1,
             slice_tokens: int | None = None) -> tuple[str, RunResult]:
        p = L.get_problem(pid)
        model = self.config.model_for(role)
        run_id = L.start_run(pid, role=role, model=model, task_id=task_id, slot=slot)
        spec = RunSpec(
            role=role, stage=stage, problem_id=pid, run_id=run_id, model=model,
            system_prompt=system_prompt, user_prompt=prompts.user_prompt(role, stage, p, extra),
            builtin_tools=BUILTIN_TOOLS[tools_key or role], task_id=task_id, slot=slot, round_no=round_no,
            max_usd=self.governor.run_max_usd(p, model, slice_tokens), timeout_seconds=self.config.run_timeout_seconds,
        )
        res = self.runner.run(spec, on_fetch=lambda kind, url: L.log_fetch(run_id, pid, role, kind, url))
        L.finish_run(run_id, status=res.status, usage=res.usage, session_id=res.session_id, error=res.error)
        if res.status == "rate_limited":
            raise RateLimited(res.error or "rate limited")
        return run_id, res

    def _parallel(self, jobs: list[Callable[[Ledger], object]]) -> list[object]:
        """Run jobs on their own ledger connections, at most max_concurrent_agents at once."""
        results: list[object] = [None] * len(jobs)
        rate_limited: list[RateLimited] = []

        def work(i: int) -> None:
            L = Ledger(self.db_path, self.config)
            try:
                results[i] = jobs[i](L)
            except RateLimited as e:
                rate_limited.append(e)
            finally:
                L.close()

        with ThreadPoolExecutor(max_workers=self.config.max_concurrent_agents) as ex:
            list(ex.map(work, range(len(jobs))))
        if rate_limited:
            raise rate_limited[0]
        return results

    # ------------------------------------------------------------ research stages
    def stage_plan(self, pid: str) -> None:
        L = self.ledger
        if L.list_tasks(pid):
            return
        self._run(L, pid, role="lead", stage="plan", system_prompt=prompts.LEAD,
                  extra={"Remaining token cap": self.governor.remaining_tokens(L.get_problem(pid))})
        if not L.list_tasks(pid):
            # Deterministic fallback: the lead produced no plan, so one subtask per must-answer item.
            p = L.get_problem(pid)
            items = p["must_answer"]
            slice_tokens = max(int(self.governor.remaining_tokens(p) * 0.5 / max(len(items), 1)), 1)
            for item in items:
                L.create_task(pid, title=item, criteria=f"Answer '{item}' with dated, quoted sources meeting: {p['evidence_standard']}",
                              budget_tokens=slice_tokens, merge_owner="supervisor")
            L.event(pid, "plan_fallback", f"lead produced no subtasks; created {len(items)} from the must-answer list")

    def stage_read(self, pid: str) -> None:
        L = self.ledger
        while True:
            L.expire_leases(pid)
            tasks = L.list_tasks(pid)
            parents = {t["parent_id"] for t in tasks if t["parent_id"]}
            open_leaves = [t for t in tasks if t["status"] == "open" and t["id"] not in parents]
            if not open_leaves:
                break
            self._guard(pid)
            batch = open_leaves[: self.config.max_concurrent_agents]
            for t in batch:
                L.event(pid, "dispatch", f"{t['id']} to a reader")
            self._parallel([self._reader_job(pid, t) for t in batch])
        # A parent whose children are all closed is merged by the synthesizer; mark it.
        for t in L.list_tasks(pid):
            if t["id"] in parents and t["status"] == "open":
                children = [c for c in L.list_tasks(pid) if c["parent_id"] == t["id"]]
                if all(c["status"] in ("done", "escalated") for c in children):
                    L.finish_task(t["id"], f"merged from {len(children)} subtasks")
        if not L.list_notes(pid):
            raise Stop("no reader produced a single note")

    def _reader_job(self, pid: str, task: dict) -> Callable[[Ledger], None]:
        def job(L: Ledger) -> None:
            run_id = L.start_run(pid, role="reader", model=self.config.model_for("reader"), task_id=task["id"])
            try:
                L.lease_task(task["id"], run_id)
            except LedgerError as e:
                L.finish_run(run_id, status="error", usage=Usage(), error=str(e))
                return
            p = L.get_problem(pid)
            model = self.config.model_for("reader")
            spec = RunSpec(
                role="reader", stage="read", problem_id=pid, run_id=run_id, model=model,
                system_prompt=prompts.READER,
                user_prompt=prompts.user_prompt("reader", "read", p, {"Your sub-question": task["title"], "Its acceptance criteria": task["criteria"]}),
                builtin_tools=BUILTIN_TOOLS["reader"], task_id=task["id"],
                max_usd=self.governor.run_max_usd(p, model, task["budget_tokens"]), timeout_seconds=self.config.run_timeout_seconds,
            )
            res = self.runner.run(spec, on_fetch=lambda kind, url: L.log_fetch(run_id, pid, "reader", kind, url))
            L.finish_run(run_id, status=res.status, usage=res.usage, session_id=res.session_id, error=res.error)
            t = L.get_task(task["id"])
            if res.status == "rate_limited":
                L.conn.execute("UPDATE tasks SET status='open', owner_run_id=NULL, lease_expires_at=NULL, lease_count=lease_count-1 WHERE id=?", (task["id"],))
                raise RateLimited(res.error or "rate limited")
            if t["status"] != "leased":
                return  # the reader closed it through the ledger
            notes = L.list_notes(pid, task_id=task["id"])
            if res.status == "ok" and notes:
                L.finish_task(task["id"], f"reader ended without finish_task; {len(notes)} notes posted", res.usage.total)
            else:
                L.release_task(task["id"], f"run {res.status}: {(res.error or 'no notes posted')[:200]}", res.usage.total)
        return job

    def stage_verify(self, pid: str) -> None:
        L = self.ledger
        for _ in range(2):
            if not L.list_notes(pid, status="unverified"):
                break
            self._guard(pid)
            self._run(L, pid, role="critic", stage="verify", system_prompt=prompts.CRITIC_VERIFY, tools_key="critic_verify", round_no=1)
        for n in L.list_notes(pid, status="unverified"):
            L.verify_note(n["id"], verified=False, reason="not verified within the critic's budget", run_id="supervisor")
        if not L.claims_for_problem(pid):
            raise Stop("no note survived verification")

    def stage_synthesize(self, pid: str) -> None:
        L = self.ledger
        if L.latest_deliverable(pid):
            return
        prompt = prompts.SYNTHESIZER_RESEARCH if L.get_problem(pid)["mode"] == RESEARCH else prompts.SYNTHESIZER_IDEAS
        self._run(L, pid, role="synthesizer", stage="synthesize", system_prompt=prompt)
        if not L.latest_deliverable(pid):
            raise Stop("synthesizer submitted no deliverable")

    def stage_critique(self, pid: str) -> None:
        L = self.ledger
        if L.list_critiques(pid, "deliverable"):
            return
        self._run(L, pid, role="critic", stage="critique", system_prompt=prompts.CRITIC_DELIVERABLE, round_no=2)
        if not L.list_critiques(pid, "deliverable"):
            L.event(pid, "critique_missing", "critic posted no critique; deliverable stands")

    def stage_revise(self, pid: str) -> None:
        L = self.ledger
        d = L.latest_deliverable(pid)
        crits = L.list_critiques(pid, "deliverable")
        objections = [o for c in crits for o in c["objections"]]
        if not d or d["version"] >= 2 or not objections:
            return
        self._guard(pid)
        self._run(L, pid, role="synthesizer", stage="revise", system_prompt=prompts.SYNTHESIZER_RESEARCH,
                  extra={"Revision": f"The critic raised {len(objections)} objections; answer each or list the item as unanswered."})

    def stage_judge(self, pid: str) -> None:
        L = self.ledger
        d = L.latest_deliverable(pid)
        if not d:
            raise Stop("nothing to judge")
        v = L.latest_verdict(pid)
        if v and v["deliverable_id"] == d["id"]:
            return
        self._run(L, pid, role="judge", stage="judge", system_prompt=prompts.JUDGE)
        v = L.latest_verdict(pid)
        if not v or v["deliverable_id"] != d["id"]:
            raise Stop("judge returned no verdict")

    def stage_close(self, pid: str) -> None:
        L = self.ledger
        d = L.latest_deliverable(pid)
        v = L.latest_verdict(pid)
        if not d or not v:
            raise Stop("nothing to close")
        if not v["passed"]:
            raise Stop(f"judge failed the deliverable: {v['reasons']}")
        L.post_reply(pid, d["id"], self.render_reply(pid, d))
        L.set_status(pid, "passed")

    # ------------------------------------------------------------ ideas stages
    def stage_diverge(self, pid: str) -> None:
        L = self.ledger
        if L.list_options(pid):
            return
        n = max(2, min(self.config.idea_thinkers, self.config.max_concurrent_agents))

        def job_for(slot: int):
            def job(Lx: Ledger):
                self._run(Lx, pid, role="thinker", stage="diverge", system_prompt=prompts.THINKER_DIVERGE,
                          extra={"You are thinker": f"{slot + 1} of {n}, working blind"}, slot=slot)
            return job

        self._parallel([job_for(s) for s in range(n)])
        if not L.list_options(pid):
            raise Stop("no thinker posted an option")

    def stage_premortem(self, pid: str) -> None:
        L = self.ledger
        if all(o["premortem"] for o in L.list_options(pid, include_withdrawn=False)):
            return
        self._run(L, pid, role="critic", stage="premortem", system_prompt=prompts.CRITIC_PREMORTEM, round_no=1)
        for o in L.list_options(pid, include_withdrawn=False):
            if not o["premortem"]:
                L.post_premortem(o["id"], "No premortem was written within the critic's budget; treat this option as unexamined.", "supervisor")

    def stage_repair(self, pid: str) -> None:
        L = self.ledger
        slots = sorted({o["author_slot"] for o in L.list_options(pid, include_withdrawn=False)})
        if not slots:
            raise Stop("every option was withdrawn before repair")

        def job_for(slot: int):
            def job(Lx: Ledger):
                self._run(Lx, pid, role="thinker", stage="repair", system_prompt=prompts.THINKER_REPAIR, slot=slot, round_no=2)
            return job

        self._guard(pid)
        self._parallel([job_for(s) for s in slots])
        if not L.list_options(pid, include_withdrawn=False):
            raise Stop("every option was withdrawn after the premortem")

    # ------------------------------------------------------------ closing
    def _escalate(self, pid: str, reason: str) -> None:
        L = self.ledger
        L.escalate(pid, reason, self.render_partial(pid))
        L.set_status(pid, "escalated", error=reason[:500])

    def render_partial(self, pid: str) -> str:
        L = self.ledger
        p = L.get_problem(pid)
        d = L.latest_deliverable(pid)
        v = L.latest_verdict(pid)
        claims = L.claims_for_problem(pid)
        lines = [f"# Partial result for {pid}", "", f"Question: {p['question']}", "",
                 f"Tokens used: {p['tokens_used']:,} of {p['token_cap']:,}; API-equivalent cost ${self._cost(p):.2f}", ""]
        tasks = L.list_tasks(pid)
        if tasks:
            lines.append("## Subtasks")
            for t in tasks:
                lines.append(f"- {t['status']}: {t['title']}" + (f" ({t['summary']})" if t["summary"] else ""))
            lines.append("")
        if v:
            lines += ["## Last verdict", f"{'pass' if v['passed'] else 'fail'}: {v['reasons']}", ""]
        if d:
            lines += [f"## Deliverable draft v{d['version']}", d["body"], ""]
            if d["unanswered"]:
                lines += ["### Unanswered", *[f"- {u}" for u in d["unanswered"]], ""]
        else:
            lines += ["## What is missing", "No deliverable was written.", ""]
        if claims:
            lines += ["## Verified claims so far", *self._claim_lines(claims), ""]
        opts = L.list_options(pid)
        if opts:
            lines.append("## Options")
            for o in opts:
                lines.append(f"- [{o['status']}] {o['title']}")
        return "\n".join(lines)

    def render_reply(self, pid: str, d: dict) -> str:
        L = self.ledger
        p = L.get_problem(pid)
        claims = L.claims_for_problem(pid)
        single = [c for c in claims if c["single_source"]]
        lines = [f"# {p['question']}", "",
                 f"Mode: {p['mode']} · Deliverable v{d['version']} · Tokens: {p['tokens_used']:,} of {p['token_cap']:,} · "
                 f"API-equivalent cost: ${self._cost(p):.2f}", ""]
        if d["unanswered"]:
            lines += ["## Unanswered must-answer items", *[f"- {u}" for u in d["unanswered"]], ""]
        if d["disagreements"]:
            lines += ["## Unresolved disagreements", d["disagreements"], ""]
        lines += ["## Deliverable", d["body"], ""]
        if claims:
            lines += [f"## Verified claims ({len(claims)}, {len(single)} single-source)", *self._claim_lines(claims), ""]
        return "\n".join(lines)

    @staticmethod
    def _claim_lines(claims: list[dict]) -> list[str]:
        out = []
        for c in claims:
            flag = " (single source)" if c["single_source"] else ""
            out.append(f"- [{c['id']}] {c['claim']} — {c['source_url']} ({c['source_date'] or 'undated'}){flag}")
        return out

    def _cost(self, p: dict) -> float:
        if p["cost_usd"]:
            return p["cost_usd"]
        return self.governor.estimate_usd(p["tokens_used"], "sonnet")


STATUS_FOR_STAGE = {
    "plan": "planning", "read": "working", "verify": "critiquing", "synthesize": "synthesizing", "critique": "critiquing",
    "revise": "synthesizing", "judge": "judging", "close": "judging",
    "diverge": "working", "premortem": "critiquing", "repair": "working",
}

RESEARCH_STAGES = [
    ("plan", Supervisor.stage_plan),
    ("read", Supervisor.stage_read),
    ("verify", Supervisor.stage_verify),
    ("synthesize", Supervisor.stage_synthesize),
    ("critique", Supervisor.stage_critique),
    ("revise", Supervisor.stage_revise),
    ("judge", Supervisor.stage_judge),
    ("close", Supervisor.stage_close),
]

IDEAS_STAGES = [
    ("diverge", Supervisor.stage_diverge),
    ("premortem", Supervisor.stage_premortem),
    ("repair", Supervisor.stage_repair),
    ("synthesize", Supervisor.stage_synthesize),
    ("judge", Supervisor.stage_judge),
    ("close", Supervisor.stage_close),
]
