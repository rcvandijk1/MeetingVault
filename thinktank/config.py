"""Settings for the think tank.

Everything a person tunes lives here: model per role, caps, the run window,
and the one swappable authentication setting (section 9 of the design).
Values come from an optional TOML file, then environment variables prefixed
``THINKTANK_``, then the defaults below.
"""
from __future__ import annotations

import os
import sys
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

DEFAULT_DB = "thinktank.sqlite3"

# Role -> model tier. Aliases resolve to the latest model in the CLI; a full
# model name works too. Section 6 of the design fixes the tiers, not the names.
# Planning and writing get the top model; reading is volume and stays cheap;
# verification is mechanical judgement and stays mid.
DEFAULT_MODELS = {
    "reader": "haiku",
    "thinker": "fable",       # the lead uses this tier too
    "critic": "sonnet",
    "synthesizer": "fable",
    "judge": "sonnet",
}
# Overrides for ideas mode, where the critic's premortem is judgement, not checking.
DEFAULT_MODELS_IDEAS = {"critic": "opus"}
# If the primary model is unavailable or refuses, the CLI continues on this one.
DEFAULT_FALLBACK_MODELS = {"thinker": "opus", "synthesizer": "opus", "critic": "opus", "reader": "sonnet", "judge": "opus"}
# Effort per role: how hard the model thinks. low | medium | high | xhigh | max.
DEFAULT_EFFORT = {"reader": "medium", "thinker": "high", "critic": "medium", "synthesizer": "high", "judge": "medium"}
DEFAULT_EFFORT_IDEAS = {"critic": "high"}


@dataclass
class Config:
    # Display name: browser tab, notifications, reply headers. One line to change.
    system_name: str = "Nightwatch"
    db_path: str = DEFAULT_DB
    claude_bin: str = "claude"
    python_bin: str = sys.executable
    # "subscription" strips ANTHROPIC_API_KEY from the agent environment so
    # runs draw on the logged-in plan; "api_key" requires the key and runs the
    # CLI in bare mode with a Console spend limit as the outer guard.
    auth_mode: str = "subscription"
    models: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_MODELS))
    models_ideas: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_MODELS_IDEAS))
    fallback_models: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_FALLBACK_MODELS))
    effort: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_EFFORT))
    effort_ideas: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_EFFORT_IDEAS))
    # Spend status (section 9). There is no hard limit on the subscription;
    # the board shows spend against this figure, the plan's monthly price.
    spend_max_usd_month: float = 100.0
    # Guard against one runaway agent, not against total spend. 0 disables.
    max_usd_per_run: float = 8.0
    run_timeout_seconds: int = 1800
    max_concurrent_agents: int = 3
    max_split_depth: int = 2
    max_critique_rounds: int = 2
    idea_thinkers: int = 3
    # Message board (agents communicate through addressed or topic-routed
    # messages; the supervisor wakes recipients). A thread closes when its
    # token budget is spent; there is no reply limit.
    thread_token_budget: int = 200_000
    max_topic_matches: int = 2
    # Where each agent's working directory (and thus its Claude Code session)
    # lives for the life of its problem. Deleted at problem close.
    agent_dir: str = "agents"
    # Only start new problems inside this local-time window ("22:00-07:00").
    # Empty means any time.
    run_window: str = ""
    poll_seconds: int = 30
    rate_limit_pause_seconds: int = 1800
    lease_seconds: int = 2400
    # Web board
    web_host: str = "127.0.0.1"
    web_port: int = 8765
    # Optional TLS for the board (PEM paths). Browsers only allow desktop
    # notifications on https (or localhost); the tab badge works either way.
    web_tls_cert: str = ""
    web_tls_key: str = ""
    # The daemon writes a heartbeat this often; the board reports it dead
    # after three misses.
    heartbeat_seconds: int = 30
    # Reader note limits (section 10: fixed schema with length limits)
    note_claim_max_chars: int = 400
    note_quote_max_chars: int = 600
    # A quote this short is found on almost any page; it is not evidence.
    note_quote_min_chars: int = 12
    # Claim expiry by type, in days (section 8). None means never.
    claim_expiry_days: dict[str, int | None] = field(
        default_factory=lambda: {
            "price": 182,
            "market_size": 182,
            "capability": 365,
            "company_fact": 730,
            "historical": None,
            "other": 365,
        }
    )
    # API list-price estimate used only to print an API-equivalent cost when
    # the CLI reports none (USD per million tokens, blended input/output).
    usd_per_million_tokens: dict[str, float] = field(
        default_factory=lambda: {"haiku": 2.0, "sonnet": 6.0, "opus": 15.0, "fable": 20.0}
    )

    @staticmethod
    def _role_key(role: str) -> str:
        # The lead is a thinker with a planning job; same tier.
        return "thinker" if role == "lead" else role

    def model_for(self, role: str, mode: str = "research") -> str:
        key = self._role_key(role)
        if mode == "ideas" and key in self.models_ideas:
            return self.models_ideas[key]
        return self.models.get(key, DEFAULT_MODELS.get(key, "sonnet"))

    def fallback_for(self, role: str, mode: str = "research") -> str | None:
        key = self._role_key(role)
        fb = self.fallback_models.get(key)
        return fb if fb and fb != self.model_for(role, mode) else None

    def effort_for(self, role: str, mode: str = "research") -> str | None:
        key = self._role_key(role)
        if mode == "ideas" and key in self.effort_ideas:
            return self.effort_ideas[key] or None
        return self.effort.get(key) or None

    def claim_expiry_for(self, claim_type: str) -> int | None:
        return self.claim_expiry_days.get(claim_type, self.claim_expiry_days.get("other"))


def load_config(path: str | os.PathLike | None = None) -> Config:
    cfg = Config()
    toml_path = Path(path) if path else Path(os.environ.get("THINKTANK_CONFIG", "thinktank.toml"))
    if toml_path.exists():
        data = tomllib.loads(toml_path.read_text())
        for f in fields(Config):
            if f.name in data:
                value = data[f.name]
                if isinstance(getattr(cfg, f.name), dict) and isinstance(value, dict):
                    merged = dict(getattr(cfg, f.name))
                    merged.update(value)
                    value = merged
                setattr(cfg, f.name, value)
    for f in fields(Config):
        env_key = "THINKTANK_" + f.name.upper()
        if env_key in os.environ:
            raw = os.environ[env_key]
            current = getattr(cfg, f.name)
            if isinstance(current, bool):
                setattr(cfg, f.name, raw.lower() in ("1", "true", "yes"))
            elif isinstance(current, int):
                setattr(cfg, f.name, int(raw))
            elif isinstance(current, float):
                setattr(cfg, f.name, float(raw))
            elif isinstance(current, dict):
                # THINKTANK_MODELS="reader=haiku,critic=sonnet"
                merged = dict(current)
                for pair in raw.split(","):
                    if "=" in pair:
                        k, v = pair.split("=", 1)
                        merged[k.strip()] = v.strip()
                setattr(cfg, f.name, merged)
            else:
                setattr(cfg, f.name, raw)
    return cfg
