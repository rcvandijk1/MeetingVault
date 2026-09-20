# Research Think Tank v0.1

A standalone research department: you post a problem with a clear
deliverable on an inbox board, ephemeral agents research and argue it out,
and a checked answer lands on a reply board. Built from the design in
"Research Think Tank — High-Level Design v0.1" (19 Sep 2026).

The environment persists; the agents do not. Boards, task ledger and claim
ledger live in one SQLite file. A deterministic Python supervisor spawns
headless Claude Code agents per problem and kills them when the problem
closes. No dependencies beyond Python 3.11 and the `claude` CLI.

```
You --post--> Inbox board --> Supervisor (plain code)
                                 |  spawn, cap, kill
                                 v
                      Ephemeral agents  <--ledger MCP-->  Task ledger, Claim ledger
                                 |  web fetch (readers and critic only)
                                 v
                    passed -> Reply board      failed / over budget -> Escalation queue
```

## Layout

| Path | Job |
|------|-----|
| `thinktank/ledger.py` | Every named operation over boards and ledgers. All rules that are "enforced in code" live here: post validation, split depth 2, budget slices, merge owner, leases, note schema limits, critique targeting, one repair round. |
| `thinktank/mcp_server.py` | The one small MCP server agents talk to. Role-scoped tools over stdio, no shell, no files, no git. |
| `thinktank/supervisor.py` | Stage machine per problem (research and ideas), agent lifecycle (birth, wake, retire), the event loop that interleaves reader dispatch with message pickups, leases, max 3 concurrent agents, cap and deadline guard, escalation, rate-limit pause. Re-entrant: resumes at the recorded stage. |
| `thinktank/runner.py` | Spawns `claude -p` with the role's tool set, the ledger as the only MCP server, prompts denied, a per-run dollar ceiling. One session per agent in its own working directory, resumed on wake, deleted at close. Reads usage and logs every fetch from the stream. |
| `thinktank/verify.py` | Mechanical quote check, no model involved: fetch the page, strip the markup, substring-match the quote. |
| `thinktank/governor.py` | Spend status (7 and 30 days, tokens and API-equivalent dollars) against the plan's monthly price; optional per-problem cap; per-run ceiling. |
| `thinktank/prompts.py` | System prompts per role and stage. |
| `thinktank/web.py` | Minimal board over SQLite: inbox with post form and spend panel, problem detail with the conversation feed and agent index, replies, escalations, claim lookup. |
| `thinktank/cli.py` | `init`, `post`, `daemon`, `run`, `web`, `status`, `purge`. |
| `docs/baseline-template.md` | Phase 0: measure the built-in Research feature before trusting this. |
| `tests/` | 42 tests with a fake runner that plays every role through the same tools a real agent uses, and a fake web. |

## Quick start

```bash
pip install -e ".[dev]"          # or just run with PYTHONPATH=. python -m thinktank
python -m pytest -q
cp thinktank.example.toml thinktank.toml   # edit models, caps, run window
thinktank init
thinktank web                    # http://127.0.0.1:8765/ — post problems here
thinktank daemon                 # in another shell; runs queued problems inside the run window
```

Post from a file instead of the board:

```bash
thinktank post problem.json      # fields: mode, question, decision, must_answer[], evidence_standard, deliverable, token_cap, deadline
thinktank run p_xxxxxxxxxx       # run one problem now, ignoring the run window
thinktank status
```

The supervisor needs a `claude` login on the box (subscription mode) or
`ANTHROPIC_API_KEY` with `auth_mode = "api_key"`. Switching is one setting.

## What a problem goes through

Research: `plan` (lead splits the must-answer list into subtasks) → `read`
(readers, one sub-question each, blind to each other, up to 3 at once) →
`verify` (two passes: the supervisor fetches every cited URL itself and
substring-matches the quote, rejecting notes whose quote is not on the
page before any model sees them; then the critic re-fetches and judges the
date and whether the quote in context supports the claim; verified notes
become ledger claims, the rest are dropped) → `synthesize` (from verified claims only) →
`critique` (objections must name a claim or a must-answer item) → `revise`
(once, only if there were objections) → `judge` (sees brief and deliverable,
nothing else) → `close` (reply board with cost printed, or escalation).

Ideas: `diverge` (2–3 thinkers, blind, no criticism) → `premortem` (critic,
one per option) → `repair` (each author, one round: repair or withdraw) →
`synthesize` (rank survivors, disagreements recorded as is) → `judge` → `close`.

A failed judgement escalates. It never loops back.

## Agents talk: the message board

Agents have identity. Each agent born for a problem gets its own Claude Code
session in its own working directory, registers itself in the agent index
with the topics it covers, and is woken by resuming that session whenever
the board has mail for it. Agents die with their problem: sessions and
directories are deleted at close.

Messages are typed (question, finding, objection, request, answer), carry
references by id, and are either addressed to one agent or routed by topic.
Routing is done by code against registered topics: at most two recipients,
most overlap first, readers and thinkers before the critic. The lead is
addressable by name only. An answer that asks nothing is recorded in its
thread but wakes nobody who was not waiting for it.
The supervisor wakes recipients inside the working stages (plan, read,
verify, premortem, repair), interleaved with reader dispatch, at most three
agents at a time. Idea divergence stays blind; from synthesis on the board
is read-only for the synthesizer and invisible to the judge.

A thread has a 200,000-token budget charged from the wakes it causes and
closes when spent. There is no reply limit. The problem page shows every
thread as a message feed, one bubble per real message, plus the agent index.

## Rules the code enforces

- Posts missing a field, with fewer than 3 or more than 7 must-answer items,
  a past deadline, or the confidential flag are rejected before any agent runs.
  The token cap is optional; empty means no cap.
- A quote that code cannot find on the page is not evidence: the note is
  rejected and the critic cannot override that. Quotes must be at least 12
  characters, so a bare figure cannot match by accident. Pages the verifier
  cannot read (PDFs, huge pages) go to the critic with the claim marked
  "quote not machine-checked" on the reply and in the ledger.
- Readers get web search, web fetch and the ledger. Thinkers, synthesizer
  and judge get the ledger only. The critic gets web fetch only in the
  verification round. Nothing gets a shell, files or git.
- Subtask: merge owner required, slice within what the parent has left,
  depth at most 2, lease that reopens once and escalates the second time.
- Notes: one atomic claim, http(s) URL, exact quote, date, type; length
  limits; treated as data everywhere.
- Claim ledger stores verified claims with provenance and expiry; expired
  claims are returned only on request and marked; reports are never fed
  back as knowledge. `thinktank purge <url-prefix>` removes a bad source.
- Spend: no hard limit on the subscription. Every run's tokens and cost are
  recorded; the inbox board and `thinktank status` show 7-day and 30-day
  spend against `spend_max_usd_month` (default 100, the plan's price). What
  still stops a problem: its own optional token cap, its deadline, and the
  per-run dollar ceiling that guards against one runaway agent. Checked
  between stages and before every batch of readers. On a rate-limit
  response the problem is queued with a pause, never retried in a loop.
- The reply prints tokens and API-equivalent cost per problem.

## Calibration

The plan's limits are not exposed as token counts. Run two problems, read
the usage page before and after, and compare with the spend panel to learn
what a percentage point of your plan costs in API-equivalent dollars.
Adjust `spend_max_usd_month` if you want the panel to track the plan's
real ceiling rather than its price. Repeat monthly.

## Known gaps in v0.1

- Cost per run comes from the CLI's `total_cost_usd`; on a subscription that
  is an API-equivalent estimate, not what you are billed.
- Token accounting counts cache reads at full weight. Conservative on purpose.
- The critic is a different tier from the author, not a different vendor.
- The board has no authentication. Keep it on loopback or a private network.
- Agent sessions hold raw web content while a problem runs. They live under
  the CLI's project directory and `agent_dir` until the problem closes.
- The deadline is the outer bound on the board as a whole; thread budgets
  bound each conversation.
