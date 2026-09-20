"""The supervisor: plain code, not an LLM (section 3).

It owns state transitions, leases, budgets and timeouts. Each problem runs
through a fixed list of stages; the stage reached is recorded on the
problem, so a crash, a rate-limit pause or a restart resumes where it
stopped instead of re-spending tokens. A failed judgement escalates; it
never loops back automatically (section 5).

Agents have identity. Each agent born for a problem gets one Claude Code
session in its own working directory, registers itself in the agent index,
and is resumed (woken) whenever the message board has something for it.
The working stages run an event loop: dispatch open tasks to new readers
and deliver pickups to existing agents, at most three agents at a time,
until nothing is open and nobody has unread mail in a thread with budget.
Agents die with their problem: sessions and working directories are deleted.
"""
from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import prompts, verify
from .config import Config
from .db import init_db, now_iso
from .governor import Governor
from .ledger import RESEARCH, Ledger, LedgerError, Usage
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
# Tools an agent gets when woken by the board, by role.
WAKE_TOOLS = {"reader": "reader", "lead": "lead", "thinker": "thinker", "critic": "critic_verify", "synthesizer": "synthesizer"}


class Stop(Exception):
    """The problem must stop: cap, deadline, or an unrecoverable failure."""


class RateLimited(Exception):
    """A run hit a rate limit; pause and queue, never retry in a tight loop."""


def _slug(text: str, n: int = 24) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:n].rstrip("-") or "agent"


def _seed_topics(*texts: str) -> list[str]:
    words = []
    for t in texts:
        for w in re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", t or ""):
            w = w.lower()
            if w not in words and w not in _STOP:
                words.append(w)
    return words[:8]


_STOP = {"which", "what", "that", "this", "with", "from", "their", "there", "into", "about", "does", "have", "will", "should",
         "must", "answer", "list", "sources", "dated", "primary", "older", "than", "months", "year", "years", "each", "every"}


class Supervisor:
    def __init__(self, config: Config, db_path: str | None = None, runner: Runner | None = None,
                 fetcher: Callable[[str], verify.Fetched] | None = None):
        self.config = config
        self.db_path = db_path or config.db_path
        init_db(self.db_path)
        self.runner: Runner = runner or ClaudeCodeRunner(config, self.db_path)
        self.fetcher = fetcher or verify.fetch_text
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
                L.conn.execute("UPDATE problems SET stage_now=?, updated_at=? WHERE id=?", (name, now_iso(), pid))
                log.info("problem %s: stage %s", pid, name)
                fn(self, pid)
                L.conn.execute("UPDATE problems SET stage=?, updated_at=? WHERE id=?", (name, now_iso(), pid))
            status = L.get_problem(pid)["status"]
        except RateLimited as e:
            L.defer(pid, self.config.rate_limit_pause_seconds, f"rate limited: {e}")
            return "queued"
        except Stop as e:
            self._escalate(pid, str(e))
            status = "escalated"
        if status in ("passed", "escalated"):
            self._retire(pid)
        return status

    def daemon(self, once: bool = False, sleep: Callable[[float], None] = time.sleep) -> None:
        """Poll the inbox board; run problems inside the run window, one at a
        time (concurrency lives inside a problem, capped at 3 agents). A
        heartbeat thread tells the board the supervisor is alive."""
        self.recover()
        self._status = "idle"
        stop = threading.Event()
        beat = threading.Thread(target=self._heartbeat_loop, args=(stop,), daemon=True)
        beat.start()
        try:
            while True:
                for p in self.ledger.list_problems("posted"):
                    self.ledger.set_status(p["id"], "queued")
                ran = False
                if self.in_run_window():
                    now = now_iso()
                    for p in self.ledger.list_problems("queued"):
                        if p["not_before"] and p["not_before"] > now:
                            continue
                        self._status = f"running {p['id']}"
                        status = self.run_problem(p["id"])
                        log.info("problem %s -> %s; spend %s", p["id"], status, self.governor.spend_status())
                        self._status = "idle"
                        ran = True
                        break
                else:
                    self._status = "outside run window"
                if once:
                    return
                if not ran:
                    sleep(self.config.poll_seconds)
        finally:
            stop.set()
            try:
                self.ledger.heartbeat("stopped")
            except Exception:  # shutting down; the board will report it dead anyway
                pass

    def _heartbeat_loop(self, stop: threading.Event) -> None:
        L = Ledger(self.db_path, self.config)
        try:
            while not stop.is_set():
                try:
                    L.heartbeat(getattr(self, "_status", "idle"))
                except Exception as e:  # never let the heartbeat kill the daemon
                    log.warning("heartbeat failed: %s", e)
                stop.wait(self.config.heartbeat_seconds)
        finally:
            L.close()

    def recover(self) -> None:
        """After a crash: runs left 'running' are dead, their leases are void,
        and problems mid-flight go back to the queue at their recorded stage.
        Agents keep their sessions and are woken as before."""
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

    # ------------------------------------------------------------ guards
    def _guard(self, pid: str) -> None:
        reason = self.governor.stop_reason(self.ledger.get_problem(pid))
        if reason:
            raise Stop(reason)

    # ------------------------------------------------------------ agent lifecycle
    def _workdir(self, pid: str, name: str) -> str:
        return str(Path(self.config.agent_dir).resolve() / pid / name)

    def _born(self, L: Ledger, pid: str, *, role: str, name: str, task_id: str | None = None, slot: int | None = None,
              topics: list[str] | None = None) -> dict:
        taken = {a["name"] for a in L.list_agents(pid, alive_only=False)}
        base, n = name, 2
        while name in taken:
            name = f"{base}-{n}"
            n += 1
        aid = L.born(pid, role=role, name=name, session_id=str(uuid.uuid4()), workdir=self._workdir(pid, name),
                     model=self.config.model_for(role), task_id=task_id, slot=slot, topics=topics)
        return L.get_agent(aid)

    def _agent(self, L: Ledger, pid: str, role: str, *, name: str | None = None, task_id: str | None = None,
               slot: int | None = None, topics: list[str] | None = None) -> tuple[dict, bool]:
        """The alive agent for this role/task/slot, or a newborn. Returns
        (agent, is_new); an agent whose first run never established a
        session (rate limited, binary missing) counts as new."""
        a = L.agent_for_run(pid, role=role, task_id=task_id, slot=slot)
        if a:
            return a, not a["session_ready"]
        return self._born(L, pid, role=role, name=name or role, task_id=task_id, slot=slot, topics=topics), True

    def _execute(self, L: Ledger, agent: dict, spec: RunSpec, *, wake: bool) -> tuple[str, RunResult]:
        pid = agent["problem_id"]
        waiting = L.pickups_waiting(agent["id"]) if wake else []
        run_id = L.start_run(pid, role=agent["role"], model=agent["model"], task_id=agent["task_id"], slot=agent["slot"], agent_id=agent["id"])
        spec.run_id = run_id
        res = self.runner.run(spec, on_fetch=lambda kind, url: L.log_fetch(run_id, pid, agent["role"], kind, url))
        L.finish_run(run_id, status=res.status, usage=res.usage, session_id=res.session_id, error=res.error)
        established = res.status != "rate_limited" and bool(res.session_id or res.status == "ok")
        L.charge_agent(agent["id"], res.usage.total, wake=wake, session_ready=established)
        if wake:
            served = L.settle_pickups(agent["id"], waiting)
            L.charge_threads(served, res.usage.total)
        if res.status == "rate_limited":
            raise RateLimited(res.error or "rate limited")
        return run_id, res

    def _spawn(self, L: Ledger, agent: dict, *, stage: str, system_prompt: str, extra: dict | None = None,
               tools_key: str | None = None, round_no: int = 1, slice_tokens: int | None = None) -> tuple[str, RunResult]:
        """An agent's first run: creates its session."""
        p = L.get_problem(agent["problem_id"])
        spec = RunSpec(
            role=agent["role"], stage=stage, problem_id=p["id"], run_id="", model=agent["model"],
            system_prompt=system_prompt, user_prompt=prompts.user_prompt(agent["role"], stage, p, extra),
            builtin_tools=BUILTIN_TOOLS[tools_key or agent["role"]], task_id=agent["task_id"], slot=agent["slot"], round_no=round_no,
            max_usd=self.governor.run_max_usd(p, agent["model"], slice_tokens), timeout_seconds=self.config.run_timeout_seconds,
            agent_id=agent["id"], session_id=agent["session_id"], resume=False, workdir=agent["workdir"],
        )
        return self._execute(L, agent, spec, wake=False)

    def _wake(self, L: Ledger, agent: dict, *, stage: str, prompt: str, tools_key: str | None = None, round_no: int = 1,
              slice_tokens: int | None = None) -> tuple[str, RunResult]:
        """Resume an agent's session with a new message."""
        p = L.get_problem(agent["problem_id"])
        spec = RunSpec(
            role=agent["role"], stage=stage, problem_id=p["id"], run_id="", model=agent["model"],
            system_prompt="", user_prompt=prompt,
            builtin_tools=BUILTIN_TOOLS[tools_key or WAKE_TOOLS.get(agent["role"], agent["role"])], task_id=agent["task_id"],
            slot=agent["slot"], round_no=round_no,
            max_usd=self.governor.run_max_usd(p, agent["model"], slice_tokens), timeout_seconds=self.config.run_timeout_seconds,
            agent_id=agent["id"], session_id=agent["session_id"], resume=True, workdir=agent["workdir"],
        )
        return self._execute(L, agent, spec, wake=True)

    def _ephemeral(self, L: Ledger, pid: str, *, role: str, stage: str, system_prompt: str, extra: dict | None = None) -> tuple[str, RunResult]:
        """A run with no identity and no session: the judge."""
        p = L.get_problem(pid)
        model = self.config.model_for(role)
        run_id = L.start_run(pid, role=role, model=model)
        spec = RunSpec(role=role, stage=stage, problem_id=pid, run_id=run_id, model=model, system_prompt=system_prompt,
                       user_prompt=prompts.user_prompt(role, stage, p, extra), builtin_tools=BUILTIN_TOOLS[role],
                       max_usd=self.governor.run_max_usd(p, model), timeout_seconds=self.config.run_timeout_seconds)
        res = self.runner.run(spec, on_fetch=lambda kind, url: L.log_fetch(run_id, pid, role, kind, url))
        L.finish_run(run_id, status=res.status, usage=res.usage, session_id=res.session_id, error=res.error)
        if res.status == "rate_limited":
            raise RateLimited(res.error or "rate limited")
        return run_id, res

    def _retire(self, pid: str) -> None:
        L = self.ledger
        L.close_threads(pid, "problem closed")
        for a in L.retire_agents(pid):
            deleter = getattr(self.runner, "delete_agent", None)
            if deleter:
                deleter(a["workdir"], a["session_id"])
        try:
            d = Path(self.config.agent_dir).resolve() / pid
            if d.exists() and not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass

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

    # ------------------------------------------------------------ the event loop
    def _pump(self, pid: str, *, stage: str, dispatch_readers: bool) -> None:
        """Interleave new reader dispatch with message pickups until the
        board is quiet: no open leaf task, no agent with unread mail in an
        open thread. Bounded by thread budgets, the deadline and the cap."""
        L = self.ledger
        while True:
            L.expire_leases(pid)
            jobs: list[Callable[[Ledger], None]] = []
            busy: set[str] = set()
            if dispatch_readers:
                tasks = L.list_tasks(pid)
                parents = {t["parent_id"] for t in tasks if t["parent_id"]}
                for t in [t for t in tasks if t["status"] == "open" and t["id"] not in parents]:
                    if len(jobs) >= self.config.max_concurrent_agents:
                        break
                    existing = L.agent_for_run(pid, role="reader", task_id=t["id"])
                    if existing:
                        busy.add(existing["id"])
                    jobs.append(self._reader_job(pid, t))
            for pk in L.pending_pickups(pid):
                if len(jobs) >= self.config.max_concurrent_agents:
                    break
                if pk["agent_id"] in busy:
                    continue
                busy.add(pk["agent_id"])
                jobs.append(self._wake_job(pid, pk["agent_id"], stage, pk["count"]))
            if not jobs:
                break
            self._guard(pid)
            self._parallel(jobs)

    def _wake_job(self, pid: str, aid: str, stage: str, count: int) -> Callable[[Ledger], None]:
        def job(L: Ledger) -> None:
            agent = L.get_agent(aid)
            L.event(pid, "wake", f"{agent['name']} for {count} message(s)")
            self._wake(L, agent, stage="wake", prompt=prompts.wake_prompt(stage, count))
        return job

    def _reader_job(self, pid: str, task: dict) -> Callable[[Ledger], None]:
        def job(L: Ledger) -> None:
            agent, is_new = self._agent(L, pid, "reader", name=f"reader-{_slug(task['title'])}", task_id=task["id"],
                                        topics=_seed_topics(task["title"], task["criteria"]))
            try:
                L.lease_task(task["id"], agent["id"])
            except LedgerError as e:
                L.event(pid, "dispatch_skipped", f"{task['id']}: {e}")
                return
            L.event(pid, "dispatch", f"{task['id']} to {agent['name']}" + ("" if is_new else " (woken)"))
            p = L.get_problem(pid)
            extra = {"Your sub-question": task["title"], "Its acceptance criteria": task["criteria"]}
            try:
                if is_new:
                    _, res = self._spawn(L, agent, stage="read", system_prompt=prompts.READER, extra=extra, slice_tokens=task["budget_tokens"])
                else:
                    _, res = self._wake(L, agent, stage="read", tools_key="reader", slice_tokens=task["budget_tokens"],
                                        prompt=f"Your previous attempt at your sub-question did not complete. Continue: post the notes you can and call finish_task. {prompts.WAKE}")
            except RateLimited:
                L.conn.execute("UPDATE tasks SET status='open', owner_run_id=NULL, lease_expires_at=NULL, lease_count=lease_count-1 WHERE id=?", (task["id"],))
                raise
            t = L.get_task(task["id"])
            if t["status"] != "leased":
                return  # the reader closed it through the ledger
            notes = L.list_notes(pid, task_id=task["id"])
            if res.status == "ok" and notes:
                L.finish_task(task["id"], f"reader ended without finish_task; {len(notes)} notes posted", res.usage.total)
            else:
                L.release_task(task["id"], f"run {res.status}: {(res.error or 'no notes posted')[:200]}", res.usage.total)
        return job

    # ------------------------------------------------------------ research stages
    def stage_plan(self, pid: str) -> None:
        L = self.ledger
        if L.list_tasks(pid):
            return
        p = L.get_problem(pid)
        lead, _ = self._agent(L, pid, "lead", name="lead", topics=_seed_topics(p["question"], " ".join(p["must_answer"])))
        remaining = self.governor.remaining_tokens(p)
        self._spawn(L, lead, stage="plan", system_prompt=prompts.LEAD,
                    extra={"Remaining token cap": "none (spend is shown, not capped)" if remaining is None else remaining})
        if not L.list_tasks(pid):
            # Deterministic fallback: the lead produced no plan, so one subtask per must-answer item.
            items = p["must_answer"]
            remaining = self.governor.remaining_tokens(p)
            slice_tokens = 200_000 if remaining is None else max(int(remaining * 0.5 / max(len(items), 1)), 1)
            for item in items:
                L.create_task(pid, title=item, criteria=f"Answer '{item}' with dated, quoted sources meeting: {p['evidence_standard']}",
                              budget_tokens=slice_tokens, merge_owner=lead["id"])
            L.event(pid, "plan_fallback", f"lead produced no subtasks; created {len(items)} from the must-answer list")

    def stage_read(self, pid: str) -> None:
        L = self.ledger
        self._pump(pid, stage="read", dispatch_readers=True)
        tasks = L.list_tasks(pid)
        parents = {t["parent_id"] for t in tasks if t["parent_id"]}
        for t in tasks:
            if t["id"] in parents and t["status"] == "open":
                children = [c for c in tasks if c["parent_id"] == t["id"]]
                if all(c["status"] in ("done", "escalated") for c in children):
                    L.finish_task(t["id"], f"merged from {len(children)} subtasks")
        if not L.list_notes(pid):
            raise Stop("no reader produced a single note")

    def stage_verify(self, pid: str) -> None:
        """Three passes, interleaved with the board. (a) The supervisor checks
        by code that each quote is on its page; a failed quote rejects the
        note before any model sees it. (b) The critic judges date and
        context. (c) Objections the critic addressed to readers wake them;
        new notes go through (a) and a second critic run."""
        L = self.ledger
        p = L.get_problem(pid)
        critic, is_new = self._agent(L, pid, "critic", name="critic", topics=["verification"] + _seed_topics(p["question"]))
        for round_no in (1, 2):
            self.check_quotes(pid)
            if not L.list_notes(pid, status="unverified", quote_checked=True):
                break
            self._guard(pid)
            if is_new:
                self._spawn(L, critic, stage="verify", system_prompt=prompts.CRITIC_VERIFY, tools_key="critic_verify", round_no=round_no)
                is_new = False
            else:
                self._wake(L, critic, stage="verify", tools_key="critic_verify", round_no=round_no,
                           prompt=f"New notes await verification (round {round_no}). Call list_notes with status unverified and verify each as before. {prompts.WAKE}")
            # Readers the critic objected to get a chance to find a better source.
            self._pump(pid, stage="verify", dispatch_readers=True)
        for n in L.list_notes(pid, status="unverified"):
            if not n["quote_check"]:
                self.check_quotes(pid)
                n = L.get_note(n["id"])
            if n["status"] == "unverified":
                L.verify_note(n["id"], verified=False, reason="not verified within the critic's budget", run_id="supervisor")
        if not L.claims_for_problem(pid):
            raise Stop("no note survived verification")

    def check_quotes(self, pid: str) -> dict[str, int]:
        """Mechanical quote check for every unverified note that has none yet.
        Pages are fetched once per call. Every fetch is logged."""
        L = self.ledger
        counts = {"pass": 0, "fail": 0, "unsupported": 0}
        cache: dict[str, verify.Fetched] = {}

        def fetch(url: str) -> verify.Fetched:
            if url not in cache:
                L.log_fetch("supervisor", pid, "supervisor", "fetch", url)
                cache[url] = self.fetcher(url)
            return cache[url]

        for n in L.list_notes(pid, status="unverified"):
            if n["quote_check"]:
                continue
            result, detail = verify.check_quote(n["url"], n["quote"], fetcher=fetch)
            L.set_quote_check(n["id"], result, detail)
            counts[result] += 1
        if sum(counts.values()):
            L.event(pid, "quote_check_done", ", ".join(f"{k} {v}" for k, v in counts.items()))
        return counts

    def stage_synthesize(self, pid: str) -> None:
        L = self.ledger
        if L.latest_deliverable(pid):
            return
        p = L.get_problem(pid)
        prompt = prompts.SYNTHESIZER_RESEARCH if p["mode"] == RESEARCH else prompts.SYNTHESIZER_IDEAS
        synth, _ = self._agent(L, pid, "synthesizer", name="synthesizer", topics=_seed_topics(p["question"]))
        self._spawn(L, synth, stage="synthesize", system_prompt=prompt)
        if not L.latest_deliverable(pid):
            raise Stop("synthesizer submitted no deliverable")

    def stage_critique(self, pid: str) -> None:
        L = self.ledger
        if L.list_critiques(pid, "deliverable"):
            return
        critic, is_new = self._agent(L, pid, "critic", name="critic")
        if is_new:
            self._spawn(L, critic, stage="critique", system_prompt=prompts.CRITIC_DELIVERABLE, round_no=2)
        else:
            self._wake(L, critic, stage="critique", tools_key="critic", round_no=2, prompt=prompts.CRITIC_DELIVERABLE)
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
        synth, is_new = self._agent(L, pid, "synthesizer", name="synthesizer")
        revision = f"The critic raised {len(objections)} objections; answer each or list the item as unanswered, then submit a new deliverable version."
        if is_new:
            self._spawn(L, synth, stage="revise", system_prompt=prompts.SYNTHESIZER_RESEARCH, extra={"Revision": revision})
        else:
            self._wake(L, synth, stage="revise", tools_key="synthesizer", prompt=f"Revision round. Call list_critiques and get_deliverable. {revision}")

    def stage_judge(self, pid: str) -> None:
        L = self.ledger
        d = L.latest_deliverable(pid)
        if not d:
            raise Stop("nothing to judge")
        v = L.latest_verdict(pid)
        if v and v["deliverable_id"] == d["id"]:
            return
        self._ephemeral(L, pid, role="judge", stage="judge", system_prompt=prompts.JUDGE)
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
        L.event(pid, "attention", "reply ready")

    # ------------------------------------------------------------ ideas stages
    def stage_diverge(self, pid: str) -> None:
        L = self.ledger
        if L.list_options(pid):
            return
        p = L.get_problem(pid)
        n = max(2, min(self.config.idea_thinkers, self.config.max_concurrent_agents))

        def job_for(slot: int):
            def job(Lx: Ledger):
                thinker, _ = self._agent(Lx, pid, "thinker", name=f"thinker-{slot + 1}", slot=slot, topics=_seed_topics(p["question"]))
                self._spawn(Lx, thinker, stage="diverge", system_prompt=prompts.THINKER_DIVERGE,
                            extra={"You are thinker": f"{slot + 1} of {n}, working blind"})
            return job

        self._parallel([job_for(s) for s in range(n)])
        if not L.list_options(pid):
            raise Stop("no thinker posted an option")

    def stage_premortem(self, pid: str) -> None:
        L = self.ledger
        p = L.get_problem(pid)
        if not all(o["premortem"] for o in L.list_options(pid, include_withdrawn=False)):
            critic, is_new = self._agent(L, pid, "critic", name="critic", topics=["premortem"] + _seed_topics(p["question"]))
            if is_new:
                self._spawn(L, critic, stage="premortem", system_prompt=prompts.CRITIC_PREMORTEM, round_no=1)
            else:
                self._wake(L, critic, stage="premortem", tools_key="critic", prompt=f"New options await a premortem. {prompts.CRITIC_PREMORTEM}")
        for o in L.list_options(pid, include_withdrawn=False):
            if not o["premortem"]:
                L.post_premortem(o["id"], "No premortem was written within the critic's budget; treat this option as unexamined.", "supervisor")

    def stage_repair(self, pid: str) -> None:
        """Each author gets one repair round, woken in its own session so it
        remembers why it proposed what it did. Then the board is open:
        thinkers combine and contest, the critic answers objections."""
        L = self.ledger
        slots = sorted({o["author_slot"] for o in L.list_options(pid, include_withdrawn=False)})
        if not slots:
            raise Stop("every option was withdrawn before repair")
        p = L.get_problem(pid)

        def job_for(slot: int):
            def job(Lx: Ledger):
                thinker, is_new = self._agent(Lx, pid, "thinker", name=f"thinker-{slot + 1}", slot=slot, topics=_seed_topics(p["question"]))
                if is_new:
                    self._spawn(Lx, thinker, stage="repair", system_prompt=prompts.THINKER_DIVERGE + "\n\n" + prompts.THINKER_REPAIR, round_no=2)
                else:
                    self._wake(Lx, thinker, stage="repair", tools_key="thinker", round_no=2, prompt=prompts.THINKER_REPAIR)
            return job

        self._guard(pid)
        self._parallel([job_for(s) for s in slots])
        self._pump(pid, stage="repair", dispatch_readers=False)
        if not L.list_options(pid, include_withdrawn=False):
            raise Stop("every option was withdrawn after the premortem")

    # ------------------------------------------------------------ closing
    def _escalate(self, pid: str, reason: str) -> None:
        L = self.ledger
        L.escalate(pid, reason, self.render_partial(pid))
        L.set_status(pid, "escalated", error=reason[:500])

    def _board_lines(self, pid: str) -> list[str]:
        L = self.ledger
        threads = L.list_threads(pid)
        if not threads:
            return []
        msgs = sum(len(t["messages"]) for t in threads)
        open_q = [t for t in threads if t["messages"] and t["messages"][0]["kind"] == "question" and not any(m["kind"] == "answer" for m in t["messages"][1:])]
        agents = L.list_agents(pid, alive_only=False)
        lines = [f"## Message board ({len(threads)} threads, {msgs} messages, {len(agents)} agents)"]
        for q in open_q:
            lines.append(f"- Open question, unanswered: {q['subject']}")
        return lines + [""]

    def render_partial(self, pid: str) -> str:
        L = self.ledger
        p = L.get_problem(pid)
        d = L.latest_deliverable(pid)
        v = L.latest_verdict(pid)
        claims = L.claims_for_problem(pid)
        lines = [f"# Partial result for {pid}", "", f"Question: {p['question']}", "",
                 f"Tokens used: {self._tokens_line(p)}; API-equivalent cost ${self._cost(p):.2f}", ""]
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
            lines.append("")
        return "\n".join(lines + self._board_lines(pid))

    def render_reply(self, pid: str, d: dict) -> str:
        L = self.ledger
        p = L.get_problem(pid)
        claims = L.claims_for_problem(pid)
        single = [c for c in claims if c["single_source"]]
        unchecked = [c for c in claims if not c["quote_checked"]]
        lines = [f"# {p['question']}", "",
                 f"{self.config.system_name} · {p['mode']} · Deliverable v{d['version']} · Tokens: {self._tokens_line(p)} · "
                 f"API-equivalent cost: ${self._cost(p):.2f}", ""]
        if d["unanswered"]:
            lines += ["## Unanswered must-answer items", *[f"- {u}" for u in d["unanswered"]], ""]
        if d["disagreements"]:
            lines += ["## Unresolved disagreements", d["disagreements"], ""]
        lines += ["## Deliverable", d["body"], ""]
        if claims:
            head = f"## Verified claims ({len(claims)}, {len(single)} single-source"
            head += f", {len(unchecked)} with quote not machine-checked)" if unchecked else ")"
            lines += [head, *self._claim_lines(claims), ""]
        return "\n".join(lines + self._board_lines(pid))

    @staticmethod
    def _tokens_line(p: dict) -> str:
        return f"{p['tokens_used']:,} of {p['token_cap']:,}" if p["token_cap"] > 0 else f"{p['tokens_used']:,} (no cap)"

    @staticmethod
    def _claim_lines(claims: list[dict]) -> list[str]:
        out = []
        for c in claims:
            flags = []
            if c["single_source"]:
                flags.append("single source")
            if not c["quote_checked"]:
                flags.append("quote not machine-checked")
            suffix = f" ({'; '.join(flags)})" if flags else ""
            out.append(f"- [{c['id']}] {c['claim']} — {c['source_url']} ({c['source_date'] or 'undated'}){suffix}")
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
