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
MESSAGE_KINDS = ("question", "finding", "objection", "request", "answer")
# Stages in which the board is open: the working stages, where the
# supervisor wakes recipients. Divergence in ideas mode stays blind; from
# synthesis on, threads are read (by synthesizer and critic) but not written.
MESSAGING_STAGES = {"plan", "read", "verify", "premortem", "repair"}
# Which roles may address which roles. Judge and synthesizer never send or receive.
MAY_MESSAGE = {
    "reader": {"reader", "lead", "critic"},
    "lead": {"reader", "lead", "critic"},
    "thinker": {"thinker", "critic"},
    "critic": {"reader", "lead", "thinker"},
}


ROLE_PRIORITY = {"reader": 0, "thinker": 0, "critic": 1, "lead": 2}


def split_topics(raw: str | list | None) -> list[str]:
    if isinstance(raw, list):
        items = raw
    else:
        items = re.split(r"[,\n;]+", raw or "")
    out = []
    for t in items:
        t = re.sub(r"\s+", " ", str(t).strip().lower())
        if t and t not in out:
            out.append(t)
    return out[:20]

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


def _topic_overlap(a: list[str], b: list[str]) -> int:
    """Count of shared topics, where one topic containing the other counts."""
    n = 0
    for x in a:
        for y in b:
            if x == y or (len(x) >= 4 and x in y) or (len(y) >= 4 and y in x):
                n += 1
                break
    return n


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
        cap = int(token_cap or 0)  # 0 means no cap: spend is shown on the board, not enforced
        if cap < 0:
            problems.append("token cap cannot be negative")
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
        remaining: int | None
        if parent_id:
            parent = self.get_task(parent_id)
            if parent["problem_id"] != pid:
                raise LedgerError("parent task belongs to another problem")
            depth = parent["depth"] + 1
            remaining = parent["budget_tokens"] - self._children_budget(parent_id) - parent["tokens_used"]
        elif p["token_cap"] > 0:
            remaining = p["token_cap"] - p["tokens_used"] - self._children_budget(None, pid)
        else:
            remaining = None  # the problem has no cap; top-level slices are the reader's own ceiling
        if depth > self.config.max_split_depth:
            raise LedgerError(f"maximum split depth is {self.config.max_split_depth}; deeper splits are refused")
        if remaining is not None and budget_tokens > remaining:
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
        if len(quote) < self.config.note_quote_min_chars:
            raise LedgerError(f"quote shorter than {self.config.note_quote_min_chars} characters; quote the full supporting sentence")
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

    def list_notes(self, pid: str, status: str | None = None, task_id: str | None = None, quote_checked: bool = False) -> list[dict]:
        sql, args = "SELECT * FROM notes WHERE problem_id=?", [pid]
        if status:
            sql += " AND status=?"
            args.append(status)
        if task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        if quote_checked:
            sql += " AND quote_check IN ('pass','unsupported')"
        return [dict(r) for r in self._all(sql + " ORDER BY created_at", *args)]

    def set_quote_check(self, nid: str, result: str, detail: str) -> None:
        """Record the supervisor's mechanical check. A failed check rejects
        the note outright: a quote that is not on the page is not evidence."""
        n = self.get_note(nid)
        self.conn.execute("UPDATE notes SET quote_check=?, quote_check_detail=? WHERE id=?", (result, detail[:500], nid))
        if result == "fail" and n["status"] == "unverified":
            self.conn.execute("UPDATE notes SET status='rejected', verify_reason=? WHERE id=?", (f"mechanical check: {detail}"[:1000], nid))
            self.event(n["problem_id"], "note_rejected", f"{nid}: quote check failed: {detail[:200]}")
        else:
            self.event(n["problem_id"], "quote_check", f"{nid}: {result}: {detail[:200]}")

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
        if verified and n["quote_check"] not in ("pass", "unsupported"):
            raise LedgerError(f"note {nid} cannot be verified: its quote was not confirmed on the page by the mechanical check")
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
               expires_at, problem_id, claim_type, tags, single_source, quote_checked)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (cid, n["claim"], n["url"], n["quote"], n["source_date"], n["created_at"], run_id, now_iso(),
             expires, n["problem_id"], n["claim_type"], tags.strip(), 0 if other else 1, 1 if n["quote_check"] == "pass" else 0),
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
    def start_run(self, pid: str, *, role: str, model: str, task_id: str | None = None, slot: int | None = None,
                  agent_id: str | None = None) -> str:
        rid = new_id("r")
        self.conn.execute(
            "INSERT INTO runs(id, problem_id, task_id, role, model, slot, agent_id, status, started_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (rid, pid, task_id, role, model, slot, agent_id, "running", now_iso()),
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

    def spend_since(self, days: int) -> dict:
        """Tokens and API-equivalent dollars over the last N days. Runs that
        reported no cost are priced at the configured list rate for their model."""
        start = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat()
        rows = self._all("SELECT model, COALESCE(SUM(total_tokens),0) t, COALESCE(SUM(cost_usd),0) c, "
                         "COALESCE(SUM(CASE WHEN cost_usd=0 THEN total_tokens ELSE 0 END),0) unpriced "
                         "FROM runs WHERE started_at >= ? GROUP BY model", start)
        tokens, usd = 0, 0.0
        for r in rows:
            tokens += int(r["t"])
            usd += float(r["c"]) + self._list_price(int(r["unpriced"]), r["model"])
        return {"tokens": tokens, "usd": usd}

    def _list_price(self, tokens: int, model: str) -> float:
        rate = None
        for alias, per_million in self.config.usd_per_million_tokens.items():
            if alias in (model or ""):
                rate = per_million
        if rate is None:
            rate = max(self.config.usd_per_million_tokens.values())
        return tokens / 1_000_000 * rate

    # ------------------------------------------------------------ agent index
    def born(self, pid: str, *, role: str, name: str, session_id: str, workdir: str, model: str,
             task_id: str | None = None, slot: int | None = None, topics: list[str] | None = None) -> str:
        """The supervisor records a birth. The agent then completes its own
        registration with register_self (topics and a one-line brief)."""
        aid = new_id("a")
        self.conn.execute(
            """INSERT INTO agents(id, problem_id, role, name, task_id, slot, topics, session_id, workdir, model, born_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, pid, role, name, task_id, slot, ",".join(split_topics(topics or [])), session_id, workdir, model, now_iso()),
        )
        self.event(pid, "agent_born", f"{aid} {name} ({role})")
        return aid

    def register_self(self, aid: str, *, topics: str | list, brief: str) -> dict:
        a = self.get_agent(aid)
        tops = split_topics(topics)
        if not tops:
            raise LedgerError("register at least one topic")
        merged = split_topics(list(a["topics"]) + tops)
        self.conn.execute("UPDATE agents SET topics=?, brief=?, registered=1 WHERE id=?", (",".join(merged), (brief or "").strip()[:400], aid))
        self.event(a["problem_id"], "agent_registered", f"{aid} {a['name']}: {', '.join(merged)}")
        return self.get_agent(aid)

    def get_agent(self, aid: str) -> dict:
        row = self._one("SELECT * FROM agents WHERE id=?", aid)
        if not row:
            raise LedgerError(f"unknown agent {aid}")
        d = dict(row)
        d["topics"] = split_topics(d["topics"].split(","))
        return d

    def agent_for_run(self, pid: str, *, role: str, task_id: str | None = None, slot: int | None = None) -> dict | None:
        sql, args = "SELECT * FROM agents WHERE problem_id=? AND role=? AND status='alive'", [pid, role]
        if task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        if slot is not None:
            sql += " AND slot=?"
            args.append(slot)
        row = self._one(sql + " ORDER BY born_at DESC LIMIT 1", *args)
        return self.get_agent(row["id"]) if row else None

    def list_agents(self, pid: str, alive_only: bool = True) -> list[dict]:
        sql = "SELECT id FROM agents WHERE problem_id=?" + (" AND status='alive'" if alive_only else "") + " ORDER BY born_at"
        return [self.get_agent(r["id"]) for r in self._all(sql, pid)]

    def find_agent(self, pid: str, ref: str) -> dict | None:
        """By id or by name, alive agents only."""
        row = self._one("SELECT id FROM agents WHERE problem_id=? AND status='alive' AND (id=? OR name=?) LIMIT 1", pid, ref, ref)
        return self.get_agent(row["id"]) if row else None

    def charge_agent(self, aid: str, tokens: int, wake: bool = False, session_ready: bool | None = None) -> None:
        self.conn.execute("UPDATE agents SET tokens_used=tokens_used+?, wakes=wakes+?, last_wake_at=CASE WHEN ? THEN ? ELSE last_wake_at END WHERE id=?",
                          (int(tokens), 1 if wake else 0, 1 if wake else 0, now_iso(), aid))
        if session_ready:
            self.conn.execute("UPDATE agents SET session_ready=1 WHERE id=?", (aid,))

    def retire_agents(self, pid: str) -> list[dict]:
        agents = self.list_agents(pid)
        self.conn.execute("UPDATE agents SET status='retired', retired_at=? WHERE problem_id=? AND status='alive'", (now_iso(), pid))
        if agents:
            self.event(pid, "agents_retired", f"{len(agents)} agents")
        return agents

    # ------------------------------------------------------------ message board
    def messaging_open(self, pid: str) -> bool:
        p = self.get_problem(pid)
        return p["status"] not in ("passed", "escalated", "rejected") and (p["stage_now"] or "") in MESSAGING_STAGES

    def post_message(self, pid: str, *, from_agent: str, kind: str, body: str, to_agent: str | None = None,
                     topics: str | list | None = None, refs: list[str] | None = None, thread_id: str | None = None) -> dict:
        """Post to the board. Addressed messages go to one recipient; topic
        messages are routed by code to agents whose registered topics overlap.
        Returns the message with its recipients."""
        sender = self.get_agent(from_agent)
        if sender["problem_id"] != pid:
            raise LedgerError("agent belongs to another problem")
        if not self.messaging_open(pid):
            raise LedgerError("the message board is closed in this stage")
        if kind not in MESSAGE_KINDS:
            raise LedgerError(f"kind must be one of {', '.join(MESSAGE_KINDS)}")
        body = (body or "").strip()
        if not body:
            raise LedgerError("body is required")
        if len(body) > 3000:
            raise LedgerError("message longer than 3000 characters; reference notes and claims by id instead of pasting them")
        refs = [str(r) for r in (refs or []) if r][:20]
        tops = split_topics(topics)
        recipients: list[dict] = []
        routing = ""
        if to_agent:
            target = self.find_agent(pid, to_agent)
            if not target:
                raise LedgerError(f"no alive agent {to_agent!r}; call list_agents for the index")
            if target["id"] == sender["id"]:
                raise LedgerError("cannot address yourself")
            if target["role"] not in MAY_MESSAGE.get(sender["role"], set()):
                raise LedgerError(f"a {sender['role']} may not address a {target['role']}")
            recipients = [target]
            routing = f"addressed to {target['name']}"
        else:
            if not tops:
                raise LedgerError("address the message to an agent or give it topics")
            scored = []
            for a in self.list_agents(pid):
                if a["id"] == sender["id"] or a["role"] not in MAY_MESSAGE.get(sender["role"], set()):
                    continue
                if a["role"] == "lead":
                    continue  # the lead is addressable only; its brief-wide topics would match everything
                overlap = _topic_overlap(tops, a["topics"])
                if overlap:
                    scored.append((overlap, a))
            # Most overlap first; on a tie the agents doing the work (readers,
            # thinkers) before the critic, and the lead last.
            scored.sort(key=lambda x: (-x[0], ROLE_PRIORITY.get(x[1]["role"], 9), x[1]["born_at"]))
            recipients = [a for _, a in scored[: self.config.max_topic_matches]]
            routing = f"topics {', '.join(tops)} -> " + (", ".join(a["name"] for a in recipients) if recipients else "no match")
        # Thread
        if thread_id:
            th = self.get_thread(thread_id)
            if th["problem_id"] != pid:
                raise LedgerError("thread belongs to another problem")
            if th["status"] != "open":
                raise LedgerError(f"thread {thread_id} is closed: {th['closed_reason']}")
            parent = self._one("SELECT id FROM messages WHERE thread_id=? ORDER BY created_at DESC LIMIT 1", thread_id)
            parent_id = parent["id"] if parent else None
        else:
            thread_id = new_id("th")
            self.conn.execute(
                "INSERT INTO threads(id, problem_id, subject, topics, budget_tokens, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (thread_id, pid, body[:120], ",".join(tops), self.config.thread_token_budget, now_iso(), now_iso()),
            )
            parent_id = None
        # An answer that asks nothing wakes nobody who was not waiting for it:
        # it is delivered only to a recipient whose last word in the thread was
        # a question, request, objection or finding. "Noted." to an answer is
        # recorded in the thread but creates no pickup.
        woken = recipients
        if kind == "answer" and "?" not in body:
            woken = [a for a in recipients if self._awaits_answer(thread_id, a["id"])]
            if len(woken) < len(recipients):
                routing += " (no pickup: answers an answer)"
        mid = new_id("m")
        self.conn.execute(
            """INSERT INTO messages(id, problem_id, thread_id, parent_id, from_agent, to_agent, kind, body, refs, topics, routing, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (mid, pid, thread_id, parent_id, sender["id"], recipients[0]["id"] if to_agent else None, kind, body,
             json.dumps(refs), ",".join(tops), routing, now_iso()),
        )
        for a in woken:
            self.conn.execute("INSERT OR IGNORE INTO pickups(message_id, agent_id, problem_id, created_at) VALUES (?,?,?,?)", (mid, a["id"], pid, now_iso()))
        self.conn.execute("UPDATE threads SET updated_at=? WHERE id=?", (now_iso(), thread_id))
        self.event(pid, "message", f"{mid} {sender['name']} [{kind}] {routing}: {body[:120]}")
        return {"message_id": mid, "thread_id": thread_id, "recipients": [a["name"] for a in recipients], "routing": routing}

    def _awaits_answer(self, thread_id: str | None, agent_id: str) -> bool:
        """True when the agent's last message in the thread was not itself an answer."""
        if not thread_id:
            return False
        row = self._one("SELECT kind FROM messages WHERE thread_id=? AND from_agent=? ORDER BY created_at DESC, rowid DESC LIMIT 1", thread_id, agent_id)
        return bool(row) and row["kind"] != "answer"

    def get_thread(self, tid: str) -> dict:
        row = self._one("SELECT * FROM threads WHERE id=?", tid)
        if not row:
            raise LedgerError(f"unknown thread {tid}")
        d = dict(row)
        d["artefacts"] = json.loads(d["artefacts"])
        return d

    def thread_messages(self, tid: str) -> list[dict]:
        rows = self._all("SELECT m.*, a.name AS from_name, a.role AS from_role FROM messages m JOIN agents a ON a.id=m.from_agent WHERE m.thread_id=? ORDER BY m.created_at", tid)
        out = []
        for r in rows:
            d = dict(r)
            d["refs"] = json.loads(d["refs"])
            out.append(d)
        return out

    def list_threads(self, pid: str) -> list[dict]:
        out = []
        for r in self._all("SELECT id FROM threads WHERE problem_id=? ORDER BY created_at", pid):
            th = self.get_thread(r["id"])
            th["messages"] = self.thread_messages(th["id"])
            out.append(th)
        return out

    def inbox(self, aid: str) -> list[dict]:
        """Messages waiting for this agent, each with its thread so far.
        Marks them delivered."""
        rows = self._all(
            "SELECT p.id AS pickup_id, m.* , a.name AS from_name, a.role AS from_role FROM pickups p JOIN messages m ON m.id=p.message_id JOIN agents a ON a.id=m.from_agent "
            "WHERE p.agent_id=? AND p.status='pending' ORDER BY m.created_at", aid)
        out = []
        for r in rows:
            d = dict(r)
            d["refs"] = json.loads(d["refs"])
            d["thread"] = [{"from": m["from_name"], "kind": m["kind"], "body": m["body"]} for m in self.thread_messages(d["thread_id"]) if m["id"] != d["id"]]
            self.conn.execute("UPDATE pickups SET status='delivered', delivered_at=? WHERE id=?", (now_iso(), r["pickup_id"]))
            out.append(d)
        return out

    def pending_pickups(self, pid: str) -> list[dict]:
        """Agents with undelivered messages in open threads with budget left."""
        rows = self._all(
            "SELECT p.agent_id, COUNT(*) n FROM pickups p JOIN messages m ON m.id=p.message_id JOIN threads t ON t.id=m.thread_id "
            "JOIN agents a ON a.id=p.agent_id WHERE p.problem_id=? AND p.status='pending' AND t.status='open' AND a.status='alive' GROUP BY p.agent_id", pid)
        return [{"agent_id": r["agent_id"], "count": int(r["n"])} for r in rows]

    def pickups_waiting(self, aid: str) -> list[int]:
        """Ids of this agent's pending pickups right now: what a wake is for."""
        return [int(r["id"]) for r in self._all("SELECT id FROM pickups WHERE agent_id=? AND status='pending'", aid)]

    def settle_pickups(self, aid: str, waiting: list[int]) -> list[str]:
        """After a wake: the pickups the agent was woken for are done, read or
        not (an agent that ignores its inbox is not woken again for the same
        message), and so is anything it read during the run. Messages that
        arrived while it was running stay pending for the next wake. Returns
        the thread ids served, for charging."""
        ids = list(waiting)
        ids += [int(r["id"]) for r in self._all("SELECT id FROM pickups WHERE agent_id=? AND status='delivered'", aid)]
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        rows = self._all(f"SELECT DISTINCT m.thread_id FROM pickups p JOIN messages m ON m.id=p.message_id WHERE p.id IN ({marks})", *ids)
        self.conn.execute(f"UPDATE pickups SET status='done' WHERE id IN ({marks})", ids)
        return [r["thread_id"] for r in rows]

    def charge_threads(self, thread_ids: list[str], tokens: int) -> list[str]:
        """Split a wake's usage evenly over the threads it served; close any
        thread whose budget is spent. Returns closed thread ids."""
        closed = []
        ids = [t for t in dict.fromkeys(thread_ids) if t]
        if not ids:
            return closed
        share = int(tokens / len(ids))
        for tid in ids:
            self.conn.execute("UPDATE threads SET tokens_used=tokens_used+?, updated_at=? WHERE id=?", (share, now_iso(), tid))
            th = self.get_thread(tid)
            if th["status"] == "open" and th["tokens_used"] >= th["budget_tokens"]:
                self.close_thread(tid, f"budget spent: {th['tokens_used']:,} of {th['budget_tokens']:,} tokens")
                closed.append(tid)
        return closed

    def close_thread(self, tid: str, reason: str) -> None:
        th = self.get_thread(tid)
        self.conn.execute("UPDATE threads SET status='closed', closed_reason=?, updated_at=? WHERE id=?", (reason[:300], now_iso(), tid))
        self.conn.execute("UPDATE pickups SET status='done' WHERE message_id IN (SELECT id FROM messages WHERE thread_id=?) AND status='pending'", (tid,))
        self.event(th["problem_id"], "thread_closed", f"{tid}: {reason[:200]}")

    def close_threads(self, pid: str, reason: str) -> int:
        n = 0
        for th in self.list_threads(pid):
            if th["status"] == "open":
                self.close_thread(th["id"], reason)
                n += 1
        return n

    def link_artefact(self, tid: str, artefact_id: str) -> None:
        th = self.get_thread(tid)
        arts = th["artefacts"]
        if artefact_id not in arts:
            arts.append(artefact_id)
            self.conn.execute("UPDATE threads SET artefacts=?, updated_at=? WHERE id=?", (json.dumps(arts), now_iso(), tid))

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

    def mark_reply_seen(self, rid: str | None = None) -> int:
        if rid:
            cur = self.conn.execute("UPDATE replies SET seen_at=? WHERE id=? AND seen_at IS NULL", (now_iso(), rid))
        else:
            cur = self.conn.execute("UPDATE replies SET seen_at=? WHERE seen_at IS NULL", (now_iso(),))
        return cur.rowcount

    # ------------------------------------------------------------ state, heartbeat, attention
    def set_state(self, key: str, value: str) -> None:
        self.conn.execute("INSERT INTO state(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                          (key, value, now_iso()))

    def get_state(self, key: str) -> tuple[str, str] | None:
        row = self._one("SELECT value, updated_at FROM state WHERE key=?", key)
        return (row["value"], row["updated_at"]) if row else None

    def heartbeat(self, status: str) -> None:
        self.set_state("daemon", status)

    def attention(self) -> dict:
        """What needs you: unread replies, open escalations, a supervisor that
        stopped beating. Computed from the database; nothing is pushed anywhere."""
        now = datetime.now(timezone.utc)
        items = []
        for r in self._all("SELECT r.id, r.problem_id, r.created_at, p.question FROM replies r JOIN problems p ON p.id=r.problem_id WHERE r.seen_at IS NULL ORDER BY r.created_at DESC"):
            items.append({"kind": "reply", "id": r["id"], "problem_id": r["problem_id"], "at": r["created_at"],
                          "text": f"Reply ready: {r['question'][:90]}", "href": f"/reply/{r['id']}"})
        for e in self.list_escalations():
            items.append({"kind": "escalation", "id": e["id"], "problem_id": e["problem_id"], "at": e["created_at"],
                          "text": f"Escalated: {e['reason'][:90]}", "href": "/escalations"})
        hb = self.get_state("daemon")
        alive, status, age = False, "never started", None
        if hb:
            status = hb[0]
            age = int((now - datetime.fromisoformat(hb[1])).total_seconds())
            alive = age < self.config.heartbeat_seconds * 3 + 15
        if not alive:
            items.append({"kind": "daemon", "id": "daemon", "problem_id": None, "at": hb[1] if hb else None,
                          "text": "Supervisor is not running" + (f" (last seen {age // 60} min ago)" if age is not None else ""), "href": "/"})
        running = [{"id": p["id"], "question": p["question"][:90], "status": p["status"], "stage": p["stage_now"]}
                   for p in self.list_problems() if p["status"] in ("planning", "working", "critiquing", "synthesizing", "judging")]
        deferred = [{"id": p["id"], "not_before": p["not_before"]} for p in self.list_problems("queued")
                    if p["not_before"] and p["not_before"] > now.replace(microsecond=0).isoformat()]
        return {"name": self.config.system_name, "count": len(items), "items": items, "daemon_alive": alive,
                "daemon_status": status, "heartbeat_age_seconds": age, "running": running, "deferred": deferred,
                "queued": sum(1 for p in self.list_problems("queued")), "at": now.replace(microsecond=0).isoformat()}

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
