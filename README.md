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
| `thinktank/supervisor.py` | Stage machine per problem (research and ideas), leases, max 3 concurrent agents, cap and deadline guard between stages, escalation, rate-limit pause. Re-entrant: resumes at the recorded stage. |
| `thinktank/runner.py` | Spawns `claude -p` with the role's tool set, the ledger as the only MCP server, prompts denied, a per-run dollar ceiling, an empty working directory. Reads usage and logs every fetch from the stream. |
| `thinktank/governor.py` | Token caps per problem and per week, per-run ceilings, API-equivalent cost. |
| `thinktank/prompts.py` | System prompts per role and stage. |
| `thinktank/web.py` | Minimal board over SQLite: inbox with post form, problem detail, replies, escalations, claim lookup. |
| `thinktank/cli.py` | `init`, `post`, `daemon`, `run`, `web`, `status`, `purge`. |
| `docs/baseline-template.md` | Phase 0: measure the built-in Research feature before trusting this. |
| `tests/` | 35 tests with a fake runner that plays every role through the same tools a real agent uses. |

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
`verify` (critic re-fetches every cited URL; verified notes become ledger
claims, the rest are dropped) → `synthesize` (from verified claims only) →
`critique` (objections must name a claim or a must-answer item) → `revise`
(once, only if there were objections) → `judge` (sees brief and deliverable,
nothing else) → `close` (reply board with cost printed, or escalation).

Ideas: `diverge` (2–3 thinkers, blind, no criticism) → `premortem` (critic,
one per option) → `repair` (each author, one round: repair or withdraw) →
`synthesize` (rank survivors, disagreements recorded as is) → `judge` → `close`.

A failed judgement escalates. It never loops back.

## Rules the code enforces

- Posts missing a field, with fewer than 3 or more than 7 must-answer items,
  a past deadline, or the confidential flag are rejected before any agent runs.
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
- Governor: per-problem cap from the post, weekly cap from config, dollar
  ceiling per run, deadline. Checked between stages and before every batch
  of readers. On a rate-limit response the problem is queued with a pause,
  never retried in a loop.
- Every run's tokens and cost are recorded; the reply prints them.

## Calibration

The plan's limits are not exposed as token counts. Run two problems, read
the usage page before and after, derive tokens per percentage point, and
set `weekly_token_cap`. Repeat monthly.

## Known gaps in v0.1

- Cost per run comes from the CLI's `total_cost_usd`; on a subscription that
  is an API-equivalent estimate, not what you are billed.
- Token accounting counts cache reads at full weight. Conservative on purpose.
- The critic is a different tier from the author, not a different vendor.
- The board has no authentication. Keep it on loopback or a private network.
