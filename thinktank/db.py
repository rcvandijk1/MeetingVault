"""SQLite schema for boards, ledgers, runs and the audit log.

One file holds everything (section 3). Full-text search over claims uses
FTS5 (section 8); no vector store.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,                 -- research | ideas
  question TEXT NOT NULL,
  decision TEXT NOT NULL,
  must_answer TEXT NOT NULL,          -- JSON list of strings
  evidence_standard TEXT NOT NULL,
  deliverable TEXT NOT NULL,
  token_cap INTEGER NOT NULL,
  deadline TEXT NOT NULL,             -- ISO 8601 UTC
  confidential INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,               -- posted|rejected|queued|planning|working|critiquing|synthesizing|judging|passed|escalated
  stage TEXT,
  not_before TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  parent_id TEXT REFERENCES tasks(id),
  depth INTEGER NOT NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL,
  budget_tokens INTEGER NOT NULL,
  merge_owner TEXT NOT NULL,          -- run id or role that owns the merge
  status TEXT NOT NULL,               -- open|leased|done|escalated
  owner_run_id TEXT,
  lease_expires_at TEXT,
  lease_count INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  task_id TEXT REFERENCES tasks(id),
  run_id TEXT,
  claim TEXT NOT NULL,
  url TEXT NOT NULL,
  quote TEXT NOT NULL,
  source_date TEXT,
  claim_type TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'unverified',   -- unverified|verified|rejected
  verify_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  source_url TEXT NOT NULL,
  quote TEXT NOT NULL,
  source_date TEXT,
  retrieved_at TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  claim_type TEXT NOT NULL DEFAULT 'other',
  tags TEXT NOT NULL DEFAULT '',
  single_source INTEGER NOT NULL DEFAULT 1,
  purged INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
  claim, quote, tags, content='claims', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS claims_ai AFTER INSERT ON claims BEGIN
  INSERT INTO claims_fts(rowid, claim, quote, tags) VALUES (new.rowid, new.claim, new.quote, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS claims_ad AFTER DELETE ON claims BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, claim, quote, tags) VALUES ('delete', old.rowid, old.claim, old.quote, old.tags);
END;

CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  author_slot INTEGER NOT NULL,
  author_run_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',   -- proposed|repaired|withdrawn
  premortem TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS critiques (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  target_kind TEXT NOT NULL,          -- deliverable | option
  target_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  body TEXT NOT NULL,
  objections TEXT NOT NULL DEFAULT '[]',   -- JSON list of {claim_id|item, objection}
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  unanswered TEXT NOT NULL DEFAULT '[]',
  disagreements TEXT NOT NULL DEFAULT '',
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verdicts (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  passed INTEGER NOT NULL,
  reasons TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  task_id TEXT,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  slot INTEGER,
  status TEXT NOT NULL,               -- running|ok|error|timeout|rate_limited
  started_at TEXT NOT NULL,
  finished_at TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  session_id TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS fetches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- fetch | search
  url TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  body TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  reason TEXT NOT NULL,
  partial TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id TEXT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_problem ON events(problem_id, id);
CREATE INDEX IF NOT EXISTS tasks_problem ON tasks(problem_id, status);
CREATE INDEX IF NOT EXISTS notes_problem ON notes(problem_id, status);
CREATE INDEX IF NOT EXISTS runs_problem ON runs(problem_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def init_db(path: str) -> None:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
    finally:
        conn.close()
