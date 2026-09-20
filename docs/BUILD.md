# Research Think Tank v0.1 — Build Document

Branch: `claude/artifact-build-dw4ib9` in `rcvandijk1/MeetingVault`
Source design: "Research Think Tank — High-Level Design v0.1", 19 Sep 2026, revision 34 (section 14 added 20 Sep)
Status: built, tested (61 tests), live-verified against the real `claude` CLI for the MCP path and the message board; not yet run on a real problem
Name: Nightwatch (display name, `system_name` in config)

---

## 1. What this is

A standalone research department. You post a problem with a clear deliverable
on an inbox board. Ephemeral agents research and argue it out. A checked answer
lands on a reply board, with its cost printed. Problems that fail judgement or
run out of road land on an escalation queue with what was found so far.

Two problem types:

- **Research**: market research and technical state of the art. Value comes from
  verified, dated facts.
- **Ideas**: development ideas and strategy options. Value comes from diverse
  options that survive an attack.

Non-goals held: no confidential material, no outbound channel other than the
reply board, no always-on agents, no integration with any other system.

## 2. Decisions applied

| Topic | Design v0.1 | As built |
|-------|-------------|----------|
| Input | Inbox board with the section 4 template | Web form and `thinktank post file.json`; every field validated in code before an agent runs |
| Output | Reply board only | Reply board; escalation queue for failures; no mail, no push |
| Content | Public topics only | Confidential flag on the post is a hard reject |
| Splitting | Agents may split, bounded | Depth ≤ 2, budget slices, merge owner required, leases reopen once then escalate |
| Critique | One assigned critic, ≤ 2 rounds | Round 1 verifies sources, round 2 attacks the deliverable; one revision, then judge |
| Memory | Verified claims only | SQLite + FTS5 claim ledger with provenance, expiry, single-source and machine-checked flags |
| Budget | Self-metered token caps | **Changed 19 Sep**: no hard limit; spend status shown against max spending on the subscription; per-problem cap optional |
| Verification | Critic re-fetches and confirms quote and date | **Changed 19 Sep**: supervisor confirms the quote by substring match in code first; critic judges date and context |
| Volume | 1–2 problems per week | Ephemeral agents, one problem at a time, ≤ 3 agents concurrently, optional off-hours window |
| Home | Own repo, own box | This repo; **local isolated box** decided 19 Sep 2026 |
| Communication | Agents blind to each other | **Changed 20 Sep**: agents have identity (one session each, resumed on wake), register in an index, and talk through a shared message board, addressed or topic-routed, interleaved with the work, in both modes; 200k tokens per thread, no reply limit |

## 3. Architecture

```
You --post--> Inbox board -----> Supervisor (deterministic Python daemon)
                                    |  spawn / cap / kill, one stage at a time
                                    v
                        Ephemeral headless Claude Code agents
                                    |            \
                       ledger MCP (only write path)   web search + fetch (readers; critic in verify)
                                    v
              SQLite: problems, tasks, notes, claims (+FTS), options, critiques,
                      deliverables, verdicts, runs, fetches, replies, escalations, events
                                    |
                   passed -> Reply board      failed / stopped -> Escalation queue
```

The supervisor is plain code, not a model. It owns state transitions, leases,
budgets and timeouts, so no agent can talk its way past a limit. Agents never
touch the database directly: every read and write goes through one MCP server
that exposes named, role-scoped operations. Agents never talk to each other
directly either: they post to a message board and the supervisor wakes the
recipients.

### Files

| Path | Lines | Job |
|------|------:|-----|
| `thinktank/config.py` | 131 | Settings from TOML, environment, defaults |
| `thinktank/db.py` | 311 | Schema, migrations, connection |
| `thinktank/ledger.py` | 954 | Every named operation; every rule enforced in code; agent index; message board and routing |
| `thinktank/mcp_server.py` | 463 | Stdio MCP server, role-scoped tools, no dependencies |
| `thinktank/prompts.py` | 174 | System prompts per role and stage; identity, messaging and wake texts |
| `thinktank/runner.py` | 261 | Spawns or resumes `claude -p` per agent, restricts tools, reads usage and fetches from the stream, deletes sessions |
| `thinktank/verify.py` | 139 | Mechanical quote check: fetch, strip markup, normalise, substring match |
| `thinktank/governor.py` | 73 | Stop reasons, per-run ceilings, spend status |
| `thinktank/supervisor.py` | 688 | Stage machines, agent lifecycle, the event loop, leases, escalation, recovery |
| `thinktank/web.py` | 250 | Board: inbox, problem detail with conversation feed and agent index, replies, escalations, ledger search |
| `thinktank/cli.py` | 98 | `init`, `post`, `daemon`, `run`, `web`, `status`, `purge` |
| `tests/` | ~1250 | 57 tests: ledger rules, MCP protocol, runner flags, verifier, board, full flows |
| `docs/baseline-template.md` | | Phase 0 measurement sheet |
| `thinktank.example.toml` | | Annotated configuration |

Dependencies: Python 3.11 standard library and the `claude` CLI. `pytest` for tests.

## 4. Data model

One SQLite file, WAL mode, one connection per thread.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `problems` | Inbox board | `mode`, `question`, `decision`, `must_answer` (JSON list, 3–7), `evidence_standard`, `deliverable`, `token_cap` (0 = none), `deadline` (ISO UTC), `status`, `stage`, `not_before`, `tokens_used`, `cost_usd`, `error` |
| `tasks` | Task ledger | `parent_id`, `depth`, `title`, `criteria`, `budget_tokens`, `merge_owner`, `status` open/leased/done/escalated, `owner_run_id`, `lease_expires_at`, `lease_count`, `tokens_used`, `summary` |
| `notes` | Reader output, fixed schema | `claim` (≤ 400 chars), `url` (http/https), `quote` (12–600 chars), `source_date`, `claim_type`, `status` unverified/verified/rejected, `quote_check` pass/fail/unsupported, `quote_check_detail`, `verify_reason` |
| `claims` | Claim ledger, the compounding asset | `claim`, `source_url`, `quote`, `source_date`, `retrieved_at`, `verified_by`, `verified_at`, `expires_at`, `problem_id`, `claim_type`, `tags`, `single_source`, `quote_checked`, `purged` |
| `claims_fts` | FTS5 over claim, quote, tags | kept in sync by triggers |
| `options` | Ideas mode | `author_slot`, `title`, `body`, `status` proposed/repaired/withdrawn, `premortem` |
| `critiques` | Critic output | `target_kind` deliverable/option, `round`, `body`, `objections` (JSON; each names a `claim_id` or `must_answer_item`) |
| `deliverables` | Versioned drafts | `version`, `body`, `unanswered` (JSON), `disagreements` |
| `verdicts` | Judge output | `deliverable_id`, `passed`, `reasons` |
| `runs` | Every agent run | `role`, `model`, `status` running/ok/error/timeout/rate_limited, input/output/cache tokens, `total_tokens`, `cost_usd`, `session_id`, `error` |
| `fetches` | Every URL touched | `run_id`, `role`, `kind` fetch/search, `url` |
| `agents` | Agent index | `role`, `name`, `task_id`, `slot`, `topics`, `brief`, `session_id`, `workdir`, `status` alive/retired, `registered`, `session_ready`, `wakes`, `tokens_used` |
| `threads` | One conversation | `subject`, `topics`, `budget_tokens` (200k), `tokens_used`, `status` open/closed, `closed_reason`, `artefacts` |
| `messages` | Board posts | `thread_id`, `parent_id`, `from_agent`, `to_agent` (addressed) or `topics` (routed), `kind`, `body` (≤ 3000), `refs`, `routing` (audit of how recipients were chosen) |
| `pickups` | One recipient's obligation to read one message | `message_id`, `agent_id`, `status` pending/delivered/done |
| `replies` | Reply board | rendered body, `tokens`, `cost_usd` |
| `escalations` | Escalation queue | `reason`, `partial` (rendered), `resolved` |
| `events` | Audit log per problem | `kind`, `detail` |

Problem status: `posted → queued → planning/working/critiquing/synthesizing/judging → passed | escalated`, or `rejected` at post time. `stage` records the last completed stage so a restart resumes without re-spending.

Claim expiry defaults (days): price 182, market_size 182, capability 365, company_fact 730, historical never, other 365.

## 5. Roles, models and tools

| Role | Model tier (default alias) | Built-in tools | Ledger tools | Board tools | Sees |
|------|----------------------------|----------------|--------------|-------------|------|
| reader | cheapest (`haiku`) | WebSearch, WebFetch | `get_task`, `search_claims`, `post_note`, `finish_task` | register, index, post, inbox, thread | one sub-question, its mail |
| lead | top (`opus`) | none | `get_problem`, `search_claims`, `list_tasks`, `post_subtask`, `list_notes` | register, index, post, inbox, thread, `list_threads` | full brief, ledger, its mail |
| thinker (ideas) | top (`opus`) | none | `get_problem`, `search_claims`, `post_option`, `list_my_options`, `repair_option`, `withdraw_option` | register, index, post, inbox, thread (board closed during divergence) | own options, its mail |
| critic | mid (`sonnet`) | WebFetch in verify and on wakes | `get_problem`, `search_claims`, `list_notes`, `verify_note`, `list_claims`, `get_deliverable`, `post_critique`, `list_critiques`, `list_tasks`, `list_options`, `post_premortem` | register, index, post, inbox, thread, `list_threads` | notes, claims, deliverable, options, its mail |
| synthesizer | top (`opus`) | none | `get_problem`, `search_claims`, `list_claims`, `list_notes`, `list_tasks`, `list_critiques`, `list_options`, `get_deliverable`, `submit_deliverable` | register, index, thread, `list_threads` (read only, cannot post) | verified claims, critiques, options, every thread |
| judge | mid (`sonnet`) | none | `get_brief`, `get_deliverable`, `submit_verdict` | none | brief and deliverable, nothing else |

Board tools: `register_self(topics, brief)`, `list_agents()`, `post_message(kind, body, to | topics, refs, thread_id)`, `read_inbox()`, `get_thread(id)`, `list_threads()`.

Who may address whom: reader → reader, lead, critic; lead → reader, lead, critic; thinker → thinker, critic; critic → reader, lead, thinker. The lead is reached by name only, never by topic. The synthesizer and judge never send or receive.

No role has a shell, file system or git. The tool list is enforced twice: the
CLI's `--tools` flag removes built-ins, and the MCP server refuses any tool not
in the role's list. The critic's `list_notes` with status unverified returns
only notes whose quote passed or was unsupported by the mechanical check.

### How an agent is spawned

```
claude -p <brief> --output-format stream-json --verbose
  --model <alias> --system-prompt <role prompt>
  --tools <role built-ins or "">
  --allowedTools <built-ins>,mcp__ledger__*
  --mcp-config '{"mcpServers":{"ledger":{"command":python,"args":["-m","thinktank.mcp_server"],"env":{THINKTANK_DB,ROLE,PROBLEM,RUN,TASK,SLOT,ROUND}}}}'
  --strict-mcp-config --permission-prompts none
  --no-session-persistence --disable-slash-commands
  [--max-budget-usd <ceiling>] [--bare in api_key mode]
```

Identity: an agent's first run passes `--session-id <uuid>` in its own
working directory under `agent_dir/<problem>/<agent>`; every wake passes
`--resume <uuid>` in the same directory, and the CLI reuses the recorded
system prompt. The judge has no identity and runs with
`--no-session-persistence` in a temp dir. At problem close the working
directory and the CLI's transcript
(`~/.claude/projects/<encoded cwd>/<uuid>.jsonl`) are deleted.

Working directories start empty, so no CLAUDE.md or project settings are
picked up. Environment: cloud, GitHub and
other provider variables stripped; `ANTHROPIC_API_KEY` stripped in
subscription mode and required in api_key mode. Timeout kills the process.
The stream is parsed live: `WebFetch` and `WebSearch` tool uses are logged to
`fetches`; the final `result` event gives usage, cost, session id and error.
A rate-limit message anywhere in the result or stderr marks the run
`rate_limited`.

## 6. Stage machines

Each problem runs through a fixed list. A stage records itself on the problem
when done; a crash, rate-limit pause or restart resumes at the next stage.
Between stages and before every batch of readers the supervisor checks the
stop conditions (own token cap if set, deadline).

### Research

| Stage | What happens | Board | Fallbacks |
|-------|--------------|-------|-----------|
| `plan` | Lead is born, checks the ledger, posts one subtask per must-answer item with criteria and a slice | open | No subtasks → supervisor creates one per must-answer item |
| `read` | Event loop: open leaf tasks dispatched to newborn readers (one agent per task, leased) and agents with unread mail woken, ≤ 3 at once, until nothing is open and no mail waits in a thread with budget | open | Run failed or no notes → task reopened once (same reader woken to continue), escalated the second time; expired leases reclaimed; parents merged when children close; zero notes overall → escalate |
| `verify` | (a) Supervisor fetches each note's URL, substring-matches the quote: fail → rejected; pass/unsupported → forward. (b) Critic is born, re-fetches, judges date and context, calls `verify_note`, may object to a reader by message. (c) Event loop: objected readers woken, may post better notes; new notes go through (a) and a critic wake for round 2 | open | Notes still unverified → rejected "not verified within the critic's budget"; zero claims → escalate |
| `synthesize` | Synthesizer is born, reads claims, tasks, threads and critiques, writes deliverable v1 from verified claims only, lists unanswered items and unanswered questions | read-only | No deliverable → escalate |
| `critique` | Critic woken, attacks v1 against brief; objections must target a claim or must-answer item | closed | No critique posted → deliverable stands |
| `revise` | Only if objections exist and version is 1: synthesizer woken, writes v2 | closed | |
| `judge` | Ephemeral judge sees brief and latest deliverable, submits pass/fail | closed | No verdict → escalate |
| `close` | Pass → reply board; fail → escalation with verdict reasons and partial. Threads closed, agents retired, sessions deleted | | Never loops back |

### Ideas

| Stage | What happens | Board | Fallbacks |
|-------|--------------|-------|-----------|
| `diverge` | 2–3 thinkers born in parallel, blind, each posts 3–5 options; no criticism | closed | No options → escalate |
| `premortem` | Critic born, writes one premortem per live option | open | Missing premortem → filled with "unexamined" marker |
| `repair` | Each thinker woken in its own session with its premortems: repair or withdraw each option. Then the event loop: thinkers combine and contest by message, the critic answers objections | open | All withdrawn → escalate |
| `synthesize` | Synthesizer ranks survivors, reads the threads, records disagreements as is | read-only | |
| `judge`, `close` | As research | closed | |

### The message board

- **Post.** A message has a kind (question, finding, objection, request,
  answer), a body ≤ 3000 chars, refs by id, and either one addressee (by
  name or id) or a list of topics. A new message opens a thread; a reply
  names the thread.
- **Route.** Addressed → one pickup. Topic → code scores every alive agent
  the sender may address, except the lead, by overlap with its registered
  topics (equal, or one contains the other with ≥ 4 chars), keeps the top
  two, tie-break readers and thinkers, then critic, then age. The lead is
  addressable by name only. No match is recorded, not an error.
- **Answers.** An answer with no question mark creates a pickup only for a
  recipient whose last message in the thread was not itself an answer.
  "Noted." to an answer is recorded but wakes nobody; the routing field says
  so.
- **Wake.** The event loop groups an agent's pending pickups into one wake:
  resume its session with "N new messages, call read_inbox". Pickups the
  wake was started for are settled afterwards whether read or not; mail that
  arrived during the wake stays pending for the next one.
- **Charge.** A wake's tokens are split evenly over the threads it served.
  A thread whose budget is spent closes and refuses further posts. Wakes
  count against the problem's tokens and the spend panel like any run.
- **Terminate.** The loop ends when no task is open and no alive agent has
  pending mail in an open thread. Bounded by thread budgets, the deadline
  and the optional cap. There is no reply limit.

## 7. Rules enforced in code

Post validation (before any agent): mode in {research, ideas}; question,
decision, evidence standard, deliverable non-empty; 3–7 must-answer items;
deadline parses (HH:MM = next occurrence local time, or ISO) and is in the
future; token cap ≥ 0 (0 = none); confidential flag → reject.

Splitting: merge owner required; slice > 0; slice ≤ parent's remaining
(parent's slice minus children minus used; for top-level, problem cap minus
used minus siblings when a cap is set); depth ≤ 2; max 3 concurrent agents.

Leases: lease on dispatch, default 40 minutes; expired or failed → reopen
once; second time → task escalated (problem continues, item is unanswered).

Notes: one claim ≤ 400 chars; http(s) URL; quote 12–600 chars verbatim;
claim type from a fixed list; task must belong to the problem.

Verification: `verify_note(verified=true)` refused unless `quote_check` is
pass or unsupported; a note already verified or rejected cannot be touched
again; a failed mechanical check rejects the note immediately.

Claims: expiry by type; single-source flag cleared when the same claim text
is verified from a different URL; search hides expired claims unless asked
and marks them; `purge <url-prefix>` retires every claim from a source.

Critique: at most 2 rounds; each objection names a `claim_id` (must exist)
or a `must_answer_item`; style is not an objection.

Ideas: only the author slot may repair or withdraw; one repair per option;
thinkers cannot list other thinkers' options.

Judge: `get_brief` returns question, decision, must-answer list, evidence
standard, deliverable spec; `get_problem` is refused for the judge.

Board: board closed outside plan/read/verify/premortem/repair; kind from
the fixed list; body ≤ 3000; addressee must be alive and addressable by
the sender's role; no self-addressing; topic posts need topics; closed
threads refuse posts; registration needs at least one topic; a rate-limited
or failed first run leaves `session_ready = 0`, so the next attempt spawns
instead of resuming a session that does not exist.

Spend: no enforced limit on the subscription. Every run's tokens (input,
output, cache read, cache create, all at full weight) and reported cost are
recorded per run and summed per problem. Runs that report no cost are priced
at the configured list rate for their model.

Containment: readers are the only role with web search; only readers and the
verify-stage critic can fetch; every fetch is logged with run, role, problem
and URL, including the supervisor's own verifier fetches; on a rate-limit
response the problem is deferred (default 30 minutes) and never retried in a
loop; the per-run dollar ceiling (default $8, 0 disables) and per-run timeout
(default 30 minutes) guard against one runaway agent.

## 8. Mechanical quote verification (`verify.py`)

1. Fetch the URL with a 25 s timeout, 3 MB ceiling, gzip accepted, a
   `thinktank-verifier/0.1` user agent, and the page's declared charset.
2. HTML or XML: strip `script`, `style`, `noscript`, `template`, `svg`; keep
   the text of everything else. Plain text: as is. Anything else (PDF,
   images) or an oversize page: `unsupported`.
3. Normalise both quote and page: Unicode NFKC, curly quotes and dashes to
   ASCII, non-breaking spaces to spaces, lowercase, collapse whitespace.
4. `pass` if the normalised quote is a substring of the normalised page, or
   if the letters-and-digits-only forms match and the quote has at least 12
   such characters. Otherwise `fail`.
5. Each URL is fetched once per problem regardless of how many notes cite it.

Outcome: `fail` rejects the note before any model sees it. `pass` and
`unsupported` go to the critic; a claim from an `unsupported` note carries
`quote_checked = 0` and the reply prints "quote not machine-checked" next to it.

## 9. Spend status

Shown on the inbox board and by `thinktank status`, never enforced:

- last 7 days and last 30 days, tokens and API-equivalent dollars
- against `spend_max_usd_month` (default 100, the plan's monthly price), as a
  percentage with a bar: green under 70 %, amber under 100 %, red above
- per problem: tokens used, cap or "no cap", cost, printed on every reply

Calibration: run two problems, read the plan's usage page before and after,
and compare with the panel. That tells you what one percentage point of the
plan costs in API-equivalent dollars. Repeat monthly; limits have moved
several times in 2026.

## 10. Configuration

`thinktank.toml` (or `THINKTANK_CONFIG`), overridden by `THINKTANK_<KEY>`
environment variables. All optional.

| Key | Default | Meaning |
|-----|---------|---------|
| `system_name` | `Nightwatch` | Display name in tab, banner, notifications and reply headers |
| `db_path` | `thinktank.sqlite3` | The one database |
| `web_tls_cert`, `web_tls_key` | empty | Optional PEM pair; serves the board over https |
| `heartbeat_seconds` | 30 | Daemon heartbeat interval; dead after three misses |
| `claude_bin` | `claude` | CLI to spawn |
| `auth_mode` | `subscription` | `subscription` strips the API key; `api_key` requires it and runs `--bare` |
| `models` | reader haiku, thinker opus, critic sonnet, synthesizer opus, judge sonnet | Aliases or full model names; lead uses the thinker tier |
| `spend_max_usd_month` | 100.0 | Reference figure for the spend panel |
| `max_usd_per_run` | 8.0 | Runaway guard per agent run; 0 disables |
| `run_timeout_seconds` | 1800 | Per agent run |
| `max_concurrent_agents` | 3 | |
| `max_split_depth` | 2 | |
| `max_critique_rounds` | 2 | |
| `idea_thinkers` | 3 | Capped by concurrency |
| `thread_token_budget` | 200000 | Per thread, charged from wakes; closes the thread when spent |
| `max_topic_matches` | 2 | Recipients per topic-routed message |
| `agent_dir` | `agents` | Working directories and sessions, per problem and agent, deleted at close |
| `run_window` | empty | e.g. `22:00-07:00` local; empty = any time |
| `poll_seconds` | 30 | Daemon poll |
| `rate_limit_pause_seconds` | 1800 | Defer after a rate-limit response |
| `lease_seconds` | 2400 | Task lease |
| `web_host`, `web_port` | 127.0.0.1, 8765 | Board; no authentication, keep it private |
| `note_claim_max_chars` | 400 | |
| `note_quote_min_chars`, `note_quote_max_chars` | 12, 600 | |
| `claim_expiry_days` | see section 4 | |
| `usd_per_million_tokens` | haiku 2, sonnet 6, opus 15, fable 20 | Blended list-price estimate for runs without a reported cost |

## 11. Operations

```bash
pip install -e ".[dev]"            # or PYTHONPATH=. python -m thinktank ...
python -m pytest -q                # 45 tests, ~2 s, no network
cp thinktank.example.toml thinktank.toml
thinktank init                     # create or migrate the database
thinktank web                      # board on http://127.0.0.1:8765/
thinktank daemon                   # supervisor loop; respects run_window
thinktank post problem.json        # post from a file
thinktank run p_xxxxxxxxxx         # run one problem now, ignoring the window
thinktank status [--json]          # spend panel and problem list
thinktank purge https://bad.example/   # retire every claim from a source
```

`problem.json` fields: `mode`, `question`, `decision`, `must_answer` (list),
`evidence_standard`, `deliverable`, `token_cap` (optional), `deadline`.

Box requirements (decided: local isolated box): Python 3.11+, the `claude`
CLI logged in to the plan, open egress, nothing else on it: no repos, no SSH
keys, no cloud credentials, no mounted drives. Bind the board to a private
network address to reach it from a phone.

Recovery: on daemon start, runs left `running` are marked failed, their
leases released, and mid-flight problems requeued at their recorded stage.
Agents keep their sessions across a restart and are woken as before.

## 12. What the reply contains

Header: question, mode, deliverable version, tokens (with cap or "no cap"),
API-equivalent cost. Then: unanswered must-answer items, unresolved
disagreements, the deliverable, the verified-claims appendix with id,
claim, URL, date, and flags for single-source and not-machine-checked, and a
board summary (threads, messages, agents, questions nobody answered).

The problem page shows every thread as a message feed, one bubble per real
message with sender, kind, addressee or topics, refs and time, and the
agent index with topics, brief, status, wakes and tokens per agent.

### Attention

`GET /api/attention` returns `{name, count, items, daemon_alive,
daemon_status, heartbeat_age_seconds, running, deferred, queued}`. Items
are unread replies (until opened or "Mark all as read"), unresolved
escalations, and "supervisor not running" when the heartbeat in the `state`
table is older than three beats. The daemon writes the heartbeat from a
background thread every `heartbeat_seconds` with its current status, and
writes `stopped` on exit. Every page carries a script that polls the
endpoint every 30 s, sets the tab title to `(n) <name>` or `(down) <name>`,
draws a favicon badge, renders the banner, and raises a desktop
notification when the count rises and permission was granted (browsers
allow that only on https or localhost; `web_tls_cert`/`web_tls_key` or
Tailscale Serve provide https). It is a pull from the laptop; the box
pushes nothing.

An escalation carries the same plus: subtask states, the last verdict, the
latest draft or "No deliverable was written", claims so far, and options.

## 13. Tests

| File | Covers |
|------|--------|
| `test_ledger.py` | Post validation, deadline parsing, optional cap, split rules, leases, note limits, quote-check gate on verify, claim expiry and single-source, FTS search and purge, critique targeting, option repair rules |
| `test_mcp_server.py` | Role scoping, refusals as tool errors, lease ownership on finish, full stdio JSON-RPC round trip |
| `test_runner.py` | Command flags per role, auth modes and environment scrubbing, stream parsing of fetches and usage, missing binary |
| `test_verify.py` | HTML stripping, typography-tolerant matching, check outcomes, governor without caps |
| `test_verify_http.py` | The real fetcher against a local HTTP server: HTML, charset, gzip, text, PDF, 404, size ceiling, connection refused |
| `test_supervisor.py` | Full research flow to reply board; one revision on objections; failed judgement escalates without looping; token cap stops between stages; deadline; no-cap spend panel; list-rate pricing; rate-limit pause and stage resume without re-spend; reader crash → reopen → escalate; plan fallback; unverified notes dropped; mechanical fail hidden from critic; critic cannot override a failed check; ideas flow; concurrency ≤ 3; crash recovery; run window |
| `test_board.py` | Index birth and self-registration; addressed and topic routing with the two-recipient cap and role rules; board closed during divergence and after synthesis; thread budget, settlement and late-mail regression; question wakes recipients and the answer wakes the asker in the same sessions; a finding to the lead yields a new subtask picked up in the same loop; a critic objection wakes a reader who posts a better note verified in round 2; answer ping-pong stops at the thread budget; ideas combine round; rate-limited first run respawns instead of resuming; retirement deletes sessions |
| `test_runner.py` (added) | Session and resume flags, agent id in the MCP env, session file path encoding and deletion |
| `test_attention.py` | Attention items, heartbeat staleness, daemon heartbeat and stop, the JSON endpoint and read-marking over a live HTTP server |

The fake runner plays every role by calling the same `call_tool` layer the
MCP server uses, so the tests exercise the real tool surface, not a mock of it.

## 14. Verified live, and not

Verified: a real `claude -p` haiku run as judge spawned the ledger MCP
server, listed its three tools, called `get_brief`, `get_deliverable` and
`submit_verdict`, and the verdict, session id, usage and cost were read back
into SQLite. The CLI accepted every flag the runner emits. The pre-existing
database migrated in place and its spend shows on the board.

Verified on 20 Sep: headless `--resume` continues a session with its
memory intact. Two real haiku agents registered themselves with their own
topics and briefs, the lead addressed a question to the critic, the critic
read its inbox and answered in the thread, the lead was woken by resuming
its session and read the answer, all pickups settled, the thread was
charged, and retirement removed both working directories and transcripts.
Cost of that exchange: four runs, about $0.09.

Not verified: any reader or critic run with web tools; the mechanical
fetcher against the open internet (the build sandbox refuses general egress);
whether `--max-budget-usd` constrains a subscription run; the token weight
the plan applies to cache reads; topic-routed messages and multi-agent wakes
with real models (tested with the fake runner only). The first real problem
is the test of these.

## 15. Deviations from the design and open points

- Two decisions changed on 19 Sep 2026 and are reflected in the doc: mechanical
  quote verification before the critic, and spend status instead of hard caps.
- One changed on 20 Sep and is section 14 of the doc: agents are no longer
  shielded from each other. They have identity and a message board. What
  remains shielded: idea divergence, the synthesizer's pen, and the judge.
- Agent sessions hold raw web content until the problem closes. Public
  topics only, so no leak risk, but this is where injected text would sit
  in full; sessions are deleted at close.
- Answer-to-answer courtesy loops are prevented in code (an answer that asks
  nothing wakes nobody who was not waiting). A loop of genuine questions is
  still bounded only by the thread budget.
- The doc's venture mode and execution layer (sections 5 and 11, added by
  another session) are not built.
- Verification of quote presence is code; the critic still uses WebFetch,
  which summarises pages through a model, for date and context. That is a
  judgement task, so it is the right tool there.
- Reader notes cannot be split further by readers; only the lead splits.
  The design allows depth 2 and the ledger enforces it; in practice v0.1
  plans are depth 1.
- Cache-read tokens are counted at full weight. Conservative on purpose;
  calibrate before trusting the token figures as a share of the plan.
- The board has no authentication and no push notifications, per the design.
- Second-vendor critic (Phase 5) not built.
- Phase 0 baseline has not been run. The kill criterion still applies: if
  Phase 1 does not beat the built-in Research feature on claim accuracy after
  6 problems, stop.
