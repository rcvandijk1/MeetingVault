"""Budget governor (section 9).

There is no hard limit on subscription spend. The supervisor measures every
run and the board shows spend against the plan's monthly price. What still
stops a problem: its own optional token cap from the post, its deadline,
and a per-run dollar ceiling that guards against one runaway agent. The
governor only answers questions; the supervisor acts on them.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .config import Config
from .ledger import Ledger

NO_CAP = 0


class Governor:
    def __init__(self, config: Config, ledger: Ledger):
        self.config = config
        self.ledger = ledger

    def stop_reason(self, problem: dict) -> str | None:
        """Why this problem must stop now, or None."""
        if problem["token_cap"] > NO_CAP and problem["tokens_used"] >= problem["token_cap"]:
            return f"token cap reached: {problem['tokens_used']:,} of {problem['token_cap']:,}"
        if problem["deadline"] <= datetime.now(timezone.utc).replace(microsecond=0).isoformat():
            return f"deadline passed: {problem['deadline']}"
        return None

    def remaining_tokens(self, problem: dict) -> int | None:
        """Tokens left under the problem's cap, or None when it has no cap."""
        if problem["token_cap"] <= NO_CAP:
            return None
        return max(problem["token_cap"] - problem["tokens_used"], 0)

    def run_max_usd(self, problem: dict, model: str, slice_tokens: int | None = None) -> float:
        """Dollar ceiling for one run: the smallest of the per-run guard, the
        API-equivalent value of the problem's remaining cap, and of the
        task's slice. 0 means no ceiling."""
        candidates = []
        if self.config.max_usd_per_run > 0:
            candidates.append(self.config.max_usd_per_run)
        remaining = self.remaining_tokens(problem)
        if remaining is not None:
            candidates.append(self.estimate_usd(remaining, model))
        if slice_tokens is not None:
            candidates.append(self.estimate_usd(slice_tokens, model))
        if not candidates:
            return 0.0
        return round(max(0.05, min(candidates)), 2)

    def estimate_usd(self, tokens: int, model: str) -> float:
        rate = None
        for alias, per_million in self.config.usd_per_million_tokens.items():
            if alias in model:
                rate = per_million
        if rate is None:
            rate = max(self.config.usd_per_million_tokens.values())
        return tokens / 1_000_000 * rate

    def spend_status(self) -> dict:
        """Spend over the last 7 and 30 days, in tokens and API-equivalent
        dollars, against the plan's monthly price. Shown, not enforced."""
        week = self.ledger.spend_since(days=7)
        month = self.ledger.spend_since(days=30)
        mx = self.config.spend_max_usd_month
        return {
            "week_tokens": week["tokens"], "week_usd": round(week["usd"], 2),
            "month_tokens": month["tokens"], "month_usd": round(month["usd"], 2),
            "max_usd_month": mx, "month_pct": round(100 * month["usd"] / mx, 1) if mx else None,
        }
