"""Spawns one ephemeral, headless Claude Code agent and reads back its usage.

The runner is the only place that knows the CLI's flags. Everything that
makes an agent safe is set here per run: the built-in tool set is limited
by role (``--tools``), the ledger MCP server is the only MCP server
(``--strict-mcp-config``), anything that would prompt is denied
(``--permission-prompts none``), no session is persisted, and the process
runs in an empty scratch directory so no CLAUDE.md or project settings are
picked up. Fetches are logged from the stream as they happen.

The authentication mode is one setting (section 9): ``subscription`` strips
any API key so the run draws on the logged-in plan; ``api_key`` requires
one and runs the CLI bare.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from .config import Config
from .ledger import Usage

RATE_LIMIT_RE = re.compile(r"rate.?limit|usage limit|limit reached|too many requests|\b429\b|overloaded|out of extra usage", re.I)


@dataclass
class RunSpec:
    role: str
    stage: str
    problem_id: str
    run_id: str
    model: str
    system_prompt: str
    user_prompt: str
    builtin_tools: tuple[str, ...] = ()
    task_id: str | None = None
    slot: int | None = None
    round_no: int = 1
    max_usd: float = 8.0
    timeout_seconds: int = 1800
    # Identity: an agent's own context is one Claude Code session in one
    # working directory, kept for the life of its problem. A first run
    # creates it (session_id set, resume False); a wake resumes it.
    agent_id: str | None = None
    session_id: str | None = None
    resume: bool = False
    workdir: str | None = None
    # Model fallback when the primary is unavailable or refuses; effort level.
    fallback_model: str | None = None
    effort: str | None = None


@dataclass
class RunResult:
    status: str  # ok | error | timeout | rate_limited
    usage: Usage = field(default_factory=Usage)
    session_id: str | None = None
    error: str | None = None
    final_text: str = ""
    num_turns: int = 0


FetchHook = Callable[[str, str], None]  # (kind, url_or_query)


class Runner(Protocol):
    def run(self, spec: RunSpec, on_fetch: FetchHook | None = None) -> RunResult: ...


def _repo_root() -> str:
    return str(Path(__file__).resolve().parent.parent)


class ClaudeCodeRunner:
    def __init__(self, config: Config, db_path: str):
        self.config = config
        self.db_path = str(Path(db_path).resolve())

    def mcp_config(self, spec: RunSpec) -> dict:
        env = {
            "THINKTANK_DB": self.db_path,
            "THINKTANK_ROLE": spec.role,
            "THINKTANK_PROBLEM": spec.problem_id,
            "THINKTANK_RUN": spec.run_id,
            "THINKTANK_TASK": spec.task_id or "",
            "THINKTANK_SLOT": "" if spec.slot is None else str(spec.slot),
            "THINKTANK_ROUND": str(spec.round_no),
            "THINKTANK_AGENT": spec.agent_id or "",
            "PYTHONPATH": _repo_root(),
        }
        cfg_path = os.environ.get("THINKTANK_CONFIG")
        if cfg_path:
            env["THINKTANK_CONFIG"] = str(Path(cfg_path).resolve())
        return {"mcpServers": {"ledger": {"command": self.config.python_bin, "args": ["-m", "thinktank.mcp_server"], "env": env}}}

    def command(self, spec: RunSpec) -> list[str]:
        allowed = list(spec.builtin_tools) + ["mcp__ledger__*"]
        cmd = [
            self.config.claude_bin, "-p", spec.user_prompt,
            "--output-format", "stream-json", "--verbose",
            "--model", spec.model,
            "--tools", ",".join(spec.builtin_tools),
            "--allowedTools", ",".join(allowed),
            "--mcp-config", json.dumps(self.mcp_config(spec)),
            "--strict-mcp-config",
            "--permission-prompts", "none",
            "--disable-slash-commands",
        ]
        if spec.fallback_model:
            cmd += ["--fallback-model", spec.fallback_model]
        if spec.effort:
            cmd += ["--effort", spec.effort]
        if spec.system_prompt:
            cmd += ["--system-prompt", spec.system_prompt]
        # On a resume the CLI reuses the session's recorded system prompt.
        if spec.resume and spec.session_id:
            cmd += ["--resume", spec.session_id]
        elif spec.session_id and spec.workdir:
            cmd += ["--session-id", spec.session_id]
        else:
            cmd.append("--no-session-persistence")
        if spec.max_usd > 0:
            cmd += ["--max-budget-usd", f"{spec.max_usd:.2f}"]
        if self.config.auth_mode == "api_key":
            cmd.append("--bare")
        return cmd

    def environment(self) -> dict[str, str]:
        env = dict(os.environ)
        # Nothing on the box but the token; the agent sees none of it.
        for k in list(env):
            if k.startswith(("AWS_", "GOOGLE_", "AZURE_", "GITHUB_", "GH_", "OPENAI_", "THINKTANK_")):
                env.pop(k)
        if self.config.auth_mode == "subscription":
            env.pop("ANTHROPIC_API_KEY", None)
        elif self.config.auth_mode == "api_key":
            if not env.get("ANTHROPIC_API_KEY"):
                raise RuntimeError("auth_mode is api_key but ANTHROPIC_API_KEY is not set")
        else:
            raise RuntimeError(f"unknown auth_mode {self.config.auth_mode!r}")
        env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
        return env

    def run(self, spec: RunSpec, on_fetch: FetchHook | None = None) -> RunResult:
        if shutil.which(self.config.claude_bin) is None:
            return RunResult(status="error", error=f"claude binary not found: {self.config.claude_bin}")
        persistent = bool(spec.workdir)
        if persistent:
            workdir = spec.workdir
            Path(workdir).mkdir(parents=True, exist_ok=True)
        else:
            workdir = tempfile.mkdtemp(prefix="thinktank-run-")
        result = RunResult(status="error")
        stderr_chunks: list[str] = []
        try:
            proc = subprocess.Popen(
                self.command(spec), cwd=workdir, env=self.environment(), stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
            )

            def drain_stderr():
                assert proc.stderr is not None
                for line in proc.stderr:
                    stderr_chunks.append(line)

            t = threading.Thread(target=drain_stderr, daemon=True)
            t.start()

            deadline = time.monotonic() + spec.timeout_seconds
            timer = threading.Timer(spec.timeout_seconds, proc.kill)
            timer.start()
            saw_result = False
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    self._consume(ev, result, on_fetch)
                    if ev.get("type") == "result":
                        saw_result = True
                proc.wait()
            finally:
                timer.cancel()
            t.join(timeout=5)
            stderr = "".join(stderr_chunks)[-4000:]
            if time.monotonic() >= deadline and not saw_result:
                result.status = "timeout"
                result.error = f"killed after {spec.timeout_seconds}s"
            elif not saw_result:
                result.status = "error"
                result.error = f"no result event (exit {proc.returncode}): {stderr.strip()[-800:]}"
            if result.status != "ok" and RATE_LIMIT_RE.search((result.error or "") + " " + result.final_text + " " + stderr):
                result.status = "rate_limited"
            elif result.status == "ok" and RATE_LIMIT_RE.search(result.final_text[-500:]) and result.num_turns <= 1:
                result.status = "rate_limited"
                result.error = result.final_text[-300:]
        finally:
            if not persistent:
                shutil.rmtree(workdir, ignore_errors=True)
        return result

    @staticmethod
    def session_file(workdir: str, session_id: str) -> Path:
        """Where the CLI keeps a session's transcript: under the user's
        Claude directory, in a folder named after the working directory."""
        home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude"))
        encoded = re.sub(r"[^A-Za-z0-9]", "-", str(Path(workdir).resolve()))
        return home / "projects" / encoded / f"{session_id}.jsonl"

    @classmethod
    def delete_agent(cls, workdir: str, session_id: str) -> None:
        """An agent dies with its problem: its working directory and its
        session transcript (which holds raw web content) are removed."""
        shutil.rmtree(workdir, ignore_errors=True)
        f = cls.session_file(workdir, session_id)
        try:
            f.unlink(missing_ok=True)
            if f.parent.exists() and not any(f.parent.iterdir()):
                f.parent.rmdir()
        except OSError:
            pass

    @staticmethod
    def _consume(ev: dict, result: RunResult, on_fetch: FetchHook | None) -> None:
        kind = ev.get("type")
        if kind == "system" and ev.get("subtype") == "init":
            result.session_id = ev.get("session_id")
        elif kind == "assistant":
            for block in (ev.get("message") or {}).get("content") or []:
                if block.get("type") != "tool_use" or not on_fetch:
                    continue
                name, inp = block.get("name", ""), block.get("input") or {}
                if name == "WebFetch" and inp.get("url"):
                    on_fetch("fetch", str(inp["url"]))
                elif name == "WebSearch" and inp.get("query"):
                    on_fetch("search", str(inp["query"]))
        elif kind == "result":
            u = ev.get("usage") or {}
            result.usage = Usage(
                input_tokens=int(u.get("input_tokens", 0) or 0),
                output_tokens=int(u.get("output_tokens", 0) or 0),
                cache_read_tokens=int(u.get("cache_read_input_tokens", 0) or 0),
                cache_create_tokens=int(u.get("cache_creation_input_tokens", 0) or 0),
                cost_usd=float(ev.get("total_cost_usd", 0) or 0),
            )
            result.session_id = ev.get("session_id") or result.session_id
            result.num_turns = int(ev.get("num_turns", 0) or 0)
            text = ev.get("result")
            result.final_text = text if isinstance(text, str) else json.dumps(text) if text else ""
            if ev.get("is_error") or str(ev.get("subtype", "")).startswith("error"):
                result.status = "error"
                result.error = f"{ev.get('subtype')}: {result.final_text[:500]}"
            else:
                result.status = "ok"
