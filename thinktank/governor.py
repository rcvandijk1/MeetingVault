"""Budget governor (section 9).

A share of a subscription cannot be enforced directly, so the supervisor
enforces token caps it measures itself: per problem (from the post), per
week (one number you tune), plus a per-run dollar ceiling handed to the CLI
and the deadline from the post. The governor only answers questions; the
supervisor acts on them.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .config import Config
from .ledger import Ledger


class Governor:
    def __init__(self, config: Config, ledger: Ledger):
        self.config = config
        self.ledger = ledger

    def stop_reason(self, problem: dict) -> str | None:
        """Why this problem must stop now, or None."""
        if problem["tokens_used"] >= problem["token_cap"]:
            return f"token cap reached: {problem['tokens_used']:,} of {problem['token_cap']:,}"
        if problem["deadline"] <= datetime.now(timezone.utc).replace(microsecond=0).isoformat():
            return f"deadline passed: {problem['deadline']}"
        week = self.ledger.week_tokens()
        if week >= self.config.weekly_token_cap:
            return f"weekly think-tank cap reached: {week:,} of {self.config.weekly_token_cap:,}"
        return None

    def remaining_tokens(self, problem: dict) -> int:
        return max(problem["token_cap"] - problem["tokens_used"], 0)

    def run_max_usd(self, problem: dict, model: str, slice_tokens: int | None = None) -> float:
        """Dollar ceiling for one run: the smaller of the configured per-run
        ceiling and the API-equivalent value of the tokens still available."""
        tokens = self.remaining_tokens(problem) if slice_tokens is None else min(slice_tokens, self.remaining_tokens(problem))
        by_tokens = self.estimate_usd(tokens, model)
        return round(max(0.05, min(self.config.max_usd_per_run, by_tokens)), 2)

    def estimate_usd(self, tokens: int, model: str) -> float:
        rate = None
        for alias, per_million in self.config.usd_per_million_tokens.items():
            if alias in model:
                rate = per_million
        if rate is None:
            rate = max(self.config.usd_per_million_tokens.values())
        return tokens / 1_000_000 * rate

    def week_summary(self) -> dict:
        used = self.ledger.week_tokens()
        return {"week_tokens": used, "weekly_cap": self.config.weekly_token_cap,
                "week_pct": round(100 * used / self.config.weekly_token_cap, 1) if self.config.weekly_token_cap else 0}
