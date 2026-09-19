"""Named operations over the boards and ledgers.

This is the only write path. The MCP server exposes a role-scoped subset of
these operations to agents; the supervisor uses the rest. Every rule the
design says is "enforced in code" (split depth, budget slices, leases, merge
owner, note schema limits, confidential posts) is enforced here, so no agent
can talk its way past it.
"""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .config import Config
from .db import connect, now_iso

RESEARCH, IDEAS = "research", "ideas"
MODES = (RESEARCH, IDEAS)
CLAIM_TYPES = ("price", "market_size", "capability", "company_fact", "historical", "other")

_URL_RE = re.compile(r"^https?://[^\s]+$")


class LedgerError(Exception):
    """A rule was violated. The message is safe to show to an agent."""


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


def parse_deadline(raw: str, now: datetime | None = None) -> str:
    """Accept ISO 8601 or HH:MM (next occurrence, local time). Returns ISO UTC."""
    raw = (raw or "").strip()
    if not raw:
        raise LedgerError("deadline is required")
    now = now or datetime.now().astimezone()
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", raw)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        if not (0 <= hh < 24 and 0 <= mm < 60):
            raise LedgerError("deadline time out of range")
        cand = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if cand <= now:
            cand += timedelta(days=1)
        return cand.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as e:
        raise LedgerError(f"deadline not understood: {raw!r}") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=now.tzinfo)
    if dt <= now:
        raise LedgerError("deadline is in the past")
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_create_tokens: int = 0
    cost_usd: float = 0.0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens + self.cache_read_tokens + self.cache_create_tokens


class Ledger:
    def __init__(self, db_path: str, config: Config | None = None):
        self.db_path = db_path
        self.config = config or Config()
        self.conn: sqlite3.Connection = connect(db_path)

    def close(self) -> None:
        self.conn.close()

    # ------------------------------------------------------------ helpers
    def _one(self, sql: str, *args) -> sqlite3.Row | None:
        return self.conn.execute(sql, args).fetchone()

    def _all(self, sql: str, *args) -> list[sqlite3.Row]:
        return self.conn.execute(sql, args).fetchall()

    def event(self, problem_id: str | None, kind: str, detail: str = "") -> None:
        self.conn.execute(
            "INSERT INTO events(problem_id, at, kind, detail) VALUES (?,?,?,?)",
            (problem_id, now_iso(), kind, detail[:4000]),
        )

    def events(self, problem_id: str, limit: int = 200) -> list[dict]:
        rows = self._all(
            "SELECT * FROM events WHERE problem_id=? ORDER BY id DESC LIMIT ?", problem_id, limit
        )
        return [dict(r) for r in rows]

    # ------------------------------------------------------------ problems
    def post_problem(
        self,
        *,
        mode: str,
        question: str,
        decision: str,
        must_answer: list[str],
        evidence_standard: str,
        deliverable: str,
        token_cap: int | None,
        deadline: str,
        confidential: bool = False,
    ) -> str:
        """Post to the inbox board. Missing fields are rejected here, before
        any agent is spawned (section 4)."""
        problems = []
        mode = (mode or "").strip().lower()
        if mode not in MODES:
            problems.append("mode must be research or ideas")
        if not question.strip():
            problems.append("question is required")
        if not decision.strip():
            problems.append("decision it feeds is required")
        items = [s.strip() for s in must_answer if s and s.strip()]
        if not (3 <= len(items) <= 7):
            problems.append("must-answer list needs 3 to 7 items")
        if not evidence_standard.strip():
            problems.append("evidence standard is required")
        if not deliverable.strip():
            problems.append("deliverable is required")
        cap = int(token_cap or 0) or self.config.default_problem_token_cap
        if cap <= 0:
            problems.append("token cap must be positive")
        try:
            deadline_iso = parse_deadline(deadline)
        except LedgerError as e:
            problems.append(str(e))
            deadline_iso = ""
        if confidential:
            problems.append("post is flagged confidential; only public topics are accepted")
        if problems:
            raise LedgerError("; ".join(problems))
        pid = new_id("p")
        ts = now_iso()
        self.conn.execute(
            """INSERT INTO problems(id, mode, question, decision, must_answer, evidence_standard,
               deliverable, token_cap, deadline, confidential, status, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, mode, question.strip(), decision.strip(), json.dumps(items), evidence_standard.strip(),
             deliverable.strip(), cap, deadline_iso, 0, "posted", ts, ts),
        )
        self.event(pid, "posted", f"{mode}: {question.strip()[:200]}")
        return pid

    def get_problem(self, pid: str) -> dict:
        row = self._one("SELECT * FROM problems WHERE id=?", pid)
        if not row:
            raise LedgerError(f"unknown problem {pid}")
        d = dict(row)
        d["must_answer"] = json.loads(d["must_answer"])
        return d

    def list_problems(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self._all("SELECT * FROM problems WHERE status=? ORDER BY created_at", status)
        else:
            rows = self._all("SELECT * FROM problems ORDER BY created_at DESC")
        out = []
        for r in rows:
            d = dict(r)
            d["must_answer"] = json.loads(d["must_answer"])
            out.append(d)
        return out

    def set_status(self, pid: str, status: str, stage: str | None = None, error: str | None = None) -> None:
        closed = now_iso() if status in ("passed", "escalated", "rejected") else None
        self.conn.execute(
            "UPDATE problems SET status=?, stage=COALESCE(?, stage), error=?, updated_at=?, closed_at=COALESCE(?, closed_at) WHERE id=?",
            (status, stage, error, now_iso(), closed, pid),
        )
        self.event(pid, "status", f"{status}{' / ' + stage if stage else ''}{' : ' + error if error else ''}")

    def defer(self, pid: str, seconds: int, reason: str) -> None:
        nb = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).replace(microsecond=0).isoformat()
        self.conn.execute("UPDATE problems SET status='queued', not_before=?, updated_at=? WHERE id=?", (nb, now_iso(), pid))
        self.event(pid, "deferred", f"until {nb}: {reason}")

    def brief(self, pid: str) -> dict:
        """What the judge sees: question, must-answer list, evidence standard,
        deliverable spec. Nothing else (section 6)."""
        p = self.get_problem(pid)
        return {k: p[k] for k in ("mode", "question", "decision", "must_answer", "evidence_standard", "deliverable")}

    # ------------------------------------------------------------ tasks
    def create_task(
        self,
        pid: str,
        *,
        title: str,
        criteria: str,
        budget_tokens: int,
        merge_owner: str,
        parent_id: str | None = None,
    ) -> str:
        """Splitting rules (section 7): merge owner required, budget slice
        within what the parent has left, depth at most max_split_depth."""
        if not merge_owner:
            raise LedgerError("a subtask without a merging owner is rejected")
        if not title.strip() or not criteria.strip():
            raise LedgerError("subtask needs a title and its own acceptance criteria")
        budget_tokens = int(budget_tokens)
        if budget_tokens <= 0:
            raise LedgerError("budget slice must be positive")
        p = self.get_problem(pid)
        depth = 1
        if parent_id:
            parent = self.get_task(parent_id)
            if parent["problem_id"] != pid:
                raise LedgerError("parent task belongs to another problem")
            depth = parent["depth"] + 1
            remaining = parent["budget_tokens"] - self._children_budget(parent_id) - parent["tokens_used"]
        else:
            remaining = p["token_cap"] - p["tokens_used"] - self._children_budget(None, pid)
        if depth > self.config.max_split_depth:
            raise LedgerError(f"maximum split depth is {self.config.max_split_depth}; deeper splits are refused")
        if budget_tokens > remaining:
            raise LedgerError(f"budget slice {budget_tokens} exceeds what the parent has left ({max(remaining, 0)})")
        tid = new_id("t")
        self.conn.execute(
            """INSERT INTO tasks(id, problem_id, parent_id, depth, title, criteria, budget_tokens, merge_owner, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (tid, pid, parent_id, depth, title.strip(), criteria.strip(), budget_tokens, merge_owner, "open", now_iso()),
        )
        self.event(pid, "task_created", f"{tid} depth {depth}: {title.strip()[:120]}")
        return tid

    def _children_budget(self, parent_id: str | None, pid: str | None = None) -> int:
        if parent_id:
            row = self._one("SELECT COALESCE(SUM(budget_tokens),0) s FROM tasks WHERE parent_id=?", parent_id)
        else:
            row = self._one("SELECT COALESCE(SUM(budget_tokens),0) s FROM tasks WHERE problem_id=? AND parent_id IS NULL", pid)
        return int(row["s"])

    def get_task(self, tid: str) -> dict:
        row = self._one("SELECT * FROM tasks WHERE id=?", tid)
        if not row:
            raise LedgerError(f"unknown task {tid}")
        return dict(row)

    def list_tasks(self, pid: str, status: str | None = None) -> list[dict]:
        if status:
            rows = self._all("SELECT * FROM tasks WHERE problem_id=? AND status=? ORDER BY created_at", pid, status)
        else:
            rows = self._all("SELECT * FROM tasks WHERE problem_id=? ORDER BY created_at", pid)
        return [dict(r) for r in rows]

    def lease_task(self, tid: str, run_id: str) -> dict:
        t = self.get_task(tid)
        if t["status"] != "open":
            raise LedgerError(f"task {tid} is {t['status']}, not open")
        exp = (datetime.now(timezone.utc) + timedelta(seconds=self.config.lease_seconds)).replace(microsecond=0).isoformat()
        self.conn.execute(
            "UPDATE tasks SET status='leased', owner_run_id=?, lease_expires_at=?, lease_count=lease_count+1 WHERE id=?",
            (run_id, exp, tid),
        )
        self.event(t["problem_id"], "task_leased", f"{tid} by {run_id} until {exp}")
        return self.get_task(tid)

    def finish_task(self, tid: str, summary: str, tokens_used: int = 0) -> None:
        t = self.get_task(tid)
        self.conn.execute(
            "UPDATE tasks SET status='done', summary=?, tokens_used=tokens_used+?, lease_expires_at=NULL WHERE id=?",
            (summary[:2000], int(tokens_used), tid),
        )
        self.event(t["problem_id"], "task_done", f"{tid}: {summary[:200]}")

    def release_task(self, tid: str, reason: str, tokens_used: int = 0) -> str:
        """A lease expired or the run failed. First time: back to the ledger.
        Second time: escalate (section 7). Returns the new status."""
        t = self.get_task(tid)
        self.conn.execute("UPDATE tasks SET tokens_used=tokens_used+? WHERE id=?", (int(tokens_used), tid))
        if t["lease_count"] >= 2:
            self.conn.execute("UPDATE tasks SET status='escalated', summary=?, lease_expires_at=NULL WHERE id=?", (reason[:2000], tid))
            self.event(t["problem_id"], "task_escalated", f"{tid}: {reason[:200]}")
            return "escalated"
        self.conn.execute("UPDATE tasks SET status='open', owner_run_id=NULL, lease_expires_at=NULL WHERE id=?", (tid,))
        self.event(t["problem_id"], "task_reopened", f"{tid}: {reason[:200]}")
        return "open"

    def expire_leases(self, pid: str) -> list[str]:
        now = now_iso()
        rows = self._all("SELECT id FROM tasks WHERE problem_id=? AND status='leased' AND lease_expires_at < ?", pid, now)
        out = []
        for r in rows:
            out.append(self.release_task(r["id"], "lease expired"))
        return out

    # ------------------------------------------------------------ notes (readers)
    def post_note(self, pid: str, *, task_id: str | None, run_id: str | None, claim: str, url: str, quote: str,
                  source_date: str | None, claim_type: str = "other") -> str:
        """Fixed schema with length limits (section 10)."""
        claim = (claim or "").strip()
        quote = (quote or "").strip()
        url = (url or "").strip()
        if not claim:
            raise LedgerError("claim is required")
        if len(claim) > self.config.note_claim_max_chars:
            raise LedgerError(f"claim longer than {self.config.note_claim_max_chars} characters; one atomic statement only")
        if not _URL_RE.match(url):
            raise LedgerError("url must be an http(s) URL")
        if not quote:
            raise LedgerError("quote is required: the exact supporting passage")
        if len(quote) > self.config.note_quote_max_chars:
            raise LedgerError(f"quote longer than {self.config.note_quote_max_chars} characters; keep it short")
        if claim_type not in CLAIM_TYPES:
            raise LedgerError(f"claim_type must be one of {', '.join(CLAIM_TYPES)}")
        if task_id:
            t = self.get_task(task_id)
            if t["problem_id"] != pid:
                raise LedgerError("task belongs to another problem")
        nid = new_id("n")
        self.conn.execute(
            """INSERT INTO notes(id, problem_id, task_id, run_id, claim, url, quote, source_date, claim_type, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (nid, pid, task_id, run_id, claim, url, quote, (source_date or "").strip() or None, claim_type, now_iso()),
        )
        return nid

    def list_notes(self, pid: str, status: str | None = None, task_id: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM notes WHERE problem_id=?", [pid]
        if status:
            sql += " AND status=?"
            args.append(status)
        if task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        return [dict(r) for r in self._all(sql + " ORDER BY created_at", *args)]

    def get_note(self, nid: str) -> dict:
        row = self._one("SELECT * FROM notes WHERE id=?", nid)
        if not row:
            raise LedgerError(f"unknown note {nid}")
        return dict(row)

    # ------------------------------------------------------------ claims (critic verifies)
    def verify_note(self, nid: str, *, verified: bool, reason: str, run_id: str, tags: str = "") -> str | None:
        """The critic re-fetched the URL and confirmed (or not) quote and
        date. Verified notes become claims; failed ones are dropped and
        logged (section 5). Returns the claim id when verified."""
        n = self.get_note(nid)
        if n["status"] != "unverified":
            raise LedgerError(f"note {nid} already {n['status']}")
        status = "verified" if verified else "rejected"
        self.conn.execute("UPDATE notes SET status=?, verify_reason=? WHERE id=?", (status, reason[:1000], nid))
        if not verified:
            self.event(n["problem_id"], "note_rejected", f"{nid}: {reason[:200]}")
            return None
        days = self.config.claim_expiry_for(n["claim_type"])
        expires = None
        if days is not None:
            expires = (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat()
        # Single-source flag: another verified claim with the same text from a different URL clears it.
        other = self._one(
            "SELECT id FROM claims WHERE claim=? AND source_url<>? AND purged=0 LIMIT 1", n["claim"], n["url"]
        )
        cid = new_id("c")
        self.conn.execute(
            """INSERT INTO claims(id, claim, source_url, quote, source_date, retrieved_at, verified_by, verified_at,
               expires_at, problem_id, claim_type, tags, single_source)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (cid, n["claim"], n["url"], n["quote"], n["source_date"], n["created_at"], run_id, now_iso(),
             expires, n["problem_id"], n["claim_type"], tags.strip(), 0 if other else 1),
        )
        if other:
            self.conn.execute("UPDATE claims SET single_source=0 WHERE id=?", (other["id"],))
        self.event(n["problem_id"], "claim_verified", f"{cid} from {nid}")
        return cid

    def search_claims(self, query: str, limit: int = 20, include_expired: bool = False) -> list[dict]:
        """Full-text lookup before searching the web. Expired claims are
        returned only on request and marked, so they are re-verified, not trusted."""
        q = " ".join(t for t in re.findall(r"[\w\-]+", query or "") if len(t) > 1)
        if not q:
            return []
        fts = " OR ".join(f'"{t}"' for t in q.split())
        rows = self._all(
            """SELECT c.* FROM claims_fts f JOIN claims c ON c.rowid = f.rowid
               WHERE claims_fts MATCH ? AND c.purged=0 ORDER BY bm25(claims_fts) LIMIT ?""",
            fts, limit,
        )
        now = now_iso()
        out = []
        for r in rows:
            d = dict(r)
            d["expired"] = bool(d["expires_at"] and d["expires_at"] < now)
            if d["expired"] and not include_expired:
                continue
            out.append(d)
        return out

    def claims_for_problem(self, pid: str) -> list[dict]:
        rows = self._all("SELECT * FROM claims WHERE problem_id=? AND purged=0 ORDER BY verified_at", pid)
        return [dict(r) for r in rows]

    def get_claim(self, cid: str) -> dict:
        row = self._one("SELECT * FROM claims WHERE id=?", cid)
        if not row:
            raise LedgerError(f"unknown claim {cid}")
        return dict(row)

    def purge_source(self, url_prefix: str) -> int:
        """A bad source was traced; purge every claim from it (section 10)."""
        cur = self.conn.execute("UPDATE claims SET purged=1 WHERE source_url LIKE ? AND purged=0", (url_prefix + "%",))
        self.event(None, "claims_purged", f"{cur.rowcount} claims from {url_prefix}")
        return cur.rowcount

    # ------------------------------------------------------------ options (ideas mode)
    def post_option(self, pid: str, *, slot: int, run_id: str | None, title: str, body: str) -> str:
        if not title.strip() or not body.strip():
            raise LedgerError("option needs a title and a body")
        oid = new_id("o")
        ts = now_iso()
        self.conn.execute(
            "INSERT INTO options(id, problem_id, author_slot, author_run_id, title, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (oid, pid, int(slot), run_id, title.strip(), body.strip(), ts, ts),
        )
        self.event(pid, "option_posted", f"{oid} by thinker {slot}: {title.strip()[:120]}")
        return oid

    def list_options(self, pid: str, slot: int | None = None, include_withdrawn: bool = True) -> list[dict]:
        sql, args = "SELECT * FROM options WHERE problem_id=?", [pid]
        if slot is not None:
            sql += " AND author_slot=?"
            args.append(int(slot))
        if not include_withdrawn:
            sql += " AND status<>'withdrawn'"
        return [dict(r) for r in self._all(sql + " ORDER BY created_at", *args)]

    def get_option(self, oid: str) -> dict:
        row = self._one("SELECT * FROM options WHERE id=?", oid)
        if not row:
            raise LedgerError(f"unknown option {oid}")
        return dict(row)

    def post_premortem(self, oid: str, body: str, run_id: str | None) -> None:
        o = self.get_option(oid)
        if not body.strip():
            raise LedgerError("premortem body is required")
        self.conn.execute("UPDATE options SET premortem=?, updated_at=? WHERE id=?", (body.strip(), now_iso(), oid))
        self.conn.execute(
            "INSERT INTO critiques(id, problem_id, target_kind, target_id, round, body, run_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (new_id("k"), o["problem_id"], "option", oid, 1, body.strip(), run_id, now_iso()),
        )
        self.event(o["problem_id"], "premortem", f"{oid}")

    def repair_option(self, oid: str, *, slot: int, body: str) -> None:
        o = self.get_option(oid)
        if o["author_slot"] != int(slot):
            raise LedgerError("only the author may repair an option")
        if o["status"] == "repaired":
            raise LedgerError("an option gets one repair round")
        if not body.strip():
            raise LedgerError("repaired body is required")
        self.conn.execute("UPDATE options SET body=?, status='repaired', updated_at=? WHERE id=?", (body.strip(), now_iso(), oid))
        self.event(o["problem_id"], "option_repaired", oid)

    def withdraw_option(self, oid: str, *, slot: int, reason: str) -> None:
        o = self.get_option(oid)
        if o["author_slot"] != int(slot):
            raise LedgerError("only the author may withdraw an option")
        self.conn.execute("UPDATE options SET status='withdrawn', updated_at=? WHERE id=?", (now_iso(), oid))
        self.event(o["problem_id"], "option_withdrawn", f"{oid}: {reason[:200]}")

    # ------------------------------------------------------------ deliverables, critiques, verdicts
    def submit_deliverable(self, pid: str, *, body: str, unanswered: list[str], disagreements: str, run_id: str | None) -> str:
        if not body.strip():
            raise LedgerError("deliverable body is required")
        row = self._one("SELECT COALESCE(MAX(version),0) v FROM deliverables WHERE problem_id=?", pid)
        version = int(row["v"]) + 1
        did = new_id("d")
        self.conn.execute(
            "INSERT INTO deliverables(id, problem_id, version, body, unanswered, disagreements, run_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (did, pid, version, body.strip(), json.dumps([u for u in unanswered if u and u.strip()]), (disagreements or "").strip(), run_id, now_iso()),
        )
        self.event(pid, "deliverable", f"{did} v{version}")
        return did

    def latest_deliverable(self, pid: str) -> dict | None:
        row = self._one("SELECT * FROM deliverables WHERE problem_id=? ORDER BY version DESC LIMIT 1", pid)
        if not row:
            return None
        d = dict(row)
        d["unanswered"] = json.loads(d["unanswered"])
        return d

    def post_critique(self, pid: str, *, deliverable_id: str, round_no: int, body: str, objections: list[dict], run_id: str | None) -> str:
        """Every objection must point at a claim or a missing must-answer item (section 7)."""
        d = self._one("SELECT id FROM deliverables WHERE id=? AND problem_id=?", deliverable_id, pid)
        if not d:
            raise LedgerError("unknown deliverable for this problem")
        if round_no > self.config.max_critique_rounds:
            raise LedgerError(f"maximum {self.config.max_critique_rounds} critique rounds")
        clean = []
        for ob in objections or []:
            if not isinstance(ob, dict) or not ob.get("objection"):
                raise LedgerError("each objection needs an 'objection' text")
            target = ob.get("claim_id") or ob.get("must_answer_item")
            if not target:
                raise LedgerError("each objection must point at a claim_id or a must_answer_item")
            if ob.get("claim_id"):
                self.get_claim(ob["claim_id"])
            clean.append({"claim_id": ob.get("claim_id"), "must_answer_item": ob.get("must_answer_item"), "objection": str(ob["objection"])[:1000]})
        kid = new_id("k")
        self.conn.execute(
            "INSERT INTO critiques(id, problem_id, target_kind, target_id, round, body, objections, run_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (kid, pid, "deliverable", deliverable_id, int(round_no), (body or "").strip(), json.dumps(clean), run_id, now_iso()),
        )
        self.event(pid, "critique", f"{kid} round {round_no}: {len(clean)} objections")
        return kid

    def list_critiques(self, pid: str, target_kind: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM critiques WHERE problem_id=?", [pid]
        if target_kind:
            sql += " AND target_kind=?"
            args.append(target_kind)
        out = []
        for r in self._all(sql + " ORDER BY created_at", *args):
            d = dict(r)
            d["objections"] = json.loads(d["objections"])
            out.append(d)
        return out

    def submit_verdict(self, pid: str, *, deliverable_id: str, passed: bool, reasons: str, run_id: str | None) -> str:
        d = self._one("SELECT id FROM deliverables WHERE id=? AND problem_id=?", deliverable_id, pid)
        if not d:
            raise LedgerError("unknown deliverable for this problem")
        if not reasons.strip():
            raise LedgerError("reasons are required")
        vid = new_id("v")
        self.conn.execute(
            "INSERT INTO verdicts(id, problem_id, deliverable_id, passed, reasons, run_id, created_at) VALUES (?,?,?,?,?,?,?)",
            (vid, pid, deliverable_id, 1 if passed else 0, reasons.strip(), run_id, now_iso()),
        )
        self.event(pid, "verdict", f"{'pass' if passed else 'fail'}: {reasons.strip()[:200]}")
        return vid

    def latest_verdict(self, pid: str) -> dict | None:
        row = self._one("SELECT * FROM verdicts WHERE problem_id=? ORDER BY created_at DESC LIMIT 1", pid)
        return dict(row) if row else None

    # ------------------------------------------------------------ runs and metering
    def start_run(self, pid: str, *, role: str, model: str, task_id: str | None = None, slot: int | None = None) -> str:
        rid = new_id("r")
        self.conn.execute(
            "INSERT INTO runs(id, problem_id, task_id, role, model, slot, status, started_at) VALUES (?,?,?,?,?,?,?,?)",
            (rid, pid, task_id, role, model, slot, "running", now_iso()),
        )
        self.event(pid, "run_started", f"{rid} {role} ({model})" + (f" task {task_id}" if task_id else ""))
        return rid

    def finish_run(self, rid: str, *, status: str, usage: Usage, session_id: str | None = None, error: str | None = None) -> None:
        row = self._one("SELECT problem_id, task_id FROM runs WHERE id=?", rid)
        if not row:
            raise LedgerError(f"unknown run {rid}")
        self.conn.execute(
            """UPDATE runs SET status=?, finished_at=?, input_tokens=?, output_tokens=?, cache_read_tokens=?,
               cache_create_tokens=?, total_tokens=?, cost_usd=?, session_id=?, error=? WHERE id=?""",
            (status, now_iso(), usage.input_tokens, usage.output_tokens, usage.cache_read_tokens,
             usage.cache_create_tokens, usage.total, usage.cost_usd, session_id, (error or "")[:2000] or None, rid),
        )
        self.conn.execute(
            "UPDATE problems SET tokens_used=tokens_used+?, cost_usd=cost_usd+?, updated_at=? WHERE id=?",
            (usage.total, usage.cost_usd, now_iso(), row["problem_id"]),
        )
        self.event(row["problem_id"], "run_finished", f"{rid} {status}: {usage.total} tokens, ${usage.cost_usd:.4f}" + (f" ({error[:160]})" if error else ""))

    def log_fetch(self, rid: str, pid: str, role: str, kind: str, url: str) -> None:
        self.conn.execute(
            "INSERT INTO fetches(run_id, problem_id, role, kind, url, at) VALUES (?,?,?,?,?,?)",
            (rid, pid, role, kind, url[:2000], now_iso()),
        )

    def list_runs(self, pid: str) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM runs WHERE problem_id=? ORDER BY started_at", pid)]

    def list_fetches(self, pid: str) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM fetches WHERE problem_id=? ORDER BY id", pid)]

    def tokens_since(self, iso_ts: str) -> int:
        row = self._one("SELECT COALESCE(SUM(total_tokens),0) s FROM runs WHERE started_at >= ?", iso_ts)
        return int(row["s"])

    def week_tokens(self) -> int:
        start = datetime.now(timezone.utc) - timedelta(days=7)
        return self.tokens_since(start.replace(microsecond=0).isoformat())

    # ------------------------------------------------------------ reply board, escalation queue
    def post_reply(self, pid: str, deliverable_id: str, body: str) -> str:
        p = self.get_problem(pid)
        rid = new_id("reply")
        self.conn.execute(
            "INSERT INTO replies(id, problem_id, deliverable_id, body, tokens, cost_usd, created_at) VALUES (?,?,?,?,?,?,?)",
            (rid, pid, deliverable_id, body, p["tokens_used"], p["cost_usd"], now_iso()),
        )
        self.event(pid, "reply_posted", rid)
        return rid

    def list_replies(self) -> list[dict]:
        return [dict(r) for r in self._all("SELECT * FROM replies ORDER BY created_at DESC")]

    def get_reply(self, rid: str) -> dict | None:
        row = self._one("SELECT * FROM replies WHERE id=?", rid)
        return dict(row) if row else None

    def escalate(self, pid: str, reason: str, partial: str) -> str:
        eid = new_id("e")
        self.conn.execute(
            "INSERT INTO escalations(id, problem_id, reason, partial, created_at) VALUES (?,?,?,?,?)",
            (eid, pid, reason, partial, now_iso()),
        )
        self.event(pid, "escalated", reason[:300])
        return eid

    def list_escalations(self, unresolved_only: bool = True) -> list[dict]:
        sql = "SELECT * FROM escalations" + (" WHERE resolved=0" if unresolved_only else "") + " ORDER BY created_at DESC"
        return [dict(r) for r in self._all(sql)]

    def resolve_escalation(self, eid: str) -> None:
        self.conn.execute("UPDATE escalations SET resolved=1 WHERE id=?", (eid,))
