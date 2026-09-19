"""Research Think Tank v0.1.

The environment persists; the agents do not. Boards, task ledger and claim
ledger live in one SQLite database. A deterministic supervisor spawns headless
Claude Code agents per problem and kills them when the problem closes.
"""

__version__ = "0.1.0"
