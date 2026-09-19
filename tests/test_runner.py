import json

import pytest

from thinktank.config import Config
from thinktank.runner import ClaudeCodeRunner, RunResult, RunSpec


def spec(**over):
    d = dict(role="reader", stage="read", problem_id="p_1", run_id="r_1", model="haiku", system_prompt="sys",
             user_prompt="do it", builtin_tools=("WebSearch", "WebFetch"), task_id="t_1", max_usd=2.5)
    d.update(over)
    return RunSpec(**d)


def test_command_limits_tools_and_wires_ledger(tmp_path):
    r = ClaudeCodeRunner(Config(), str(tmp_path / "db"))
    cmd = r.command(spec())
    assert cmd[cmd.index("--tools") + 1] == "WebSearch,WebFetch"
    assert cmd[cmd.index("--allowedTools") + 1] == "WebSearch,WebFetch,mcp__ledger__*"
    assert "--strict-mcp-config" in cmd and "--permission-prompts" in cmd and "--no-session-persistence" in cmd
    assert cmd[cmd.index("--max-budget-usd") + 1] == "2.50"
    mcp = json.loads(cmd[cmd.index("--mcp-config") + 1])
    env = mcp["mcpServers"]["ledger"]["env"]
    assert env["THINKTANK_ROLE"] == "reader" and env["THINKTANK_TASK"] == "t_1" and env["THINKTANK_RUN"] == "r_1"
    assert "--bare" not in cmd
    judge = r.command(spec(role="judge", builtin_tools=()))
    assert judge[judge.index("--tools") + 1] == ""
    assert judge[judge.index("--allowedTools") + 1] == "mcp__ledger__*"
    assert "--max-budget-usd" not in r.command(spec(max_usd=0))


def test_auth_modes(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "leak")
    sub = ClaudeCodeRunner(Config(auth_mode="subscription"), str(tmp_path / "db"))
    env = sub.environment()
    assert "ANTHROPIC_API_KEY" not in env and "AWS_SECRET_ACCESS_KEY" not in env
    api = ClaudeCodeRunner(Config(auth_mode="api_key"), str(tmp_path / "db"))
    assert api.environment()["ANTHROPIC_API_KEY"] == "sk-test"
    assert "--bare" in api.command(spec())
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        api.environment()


def test_stream_parsing_logs_fetches_and_usage():
    fetched = []
    res = RunResult(status="error")
    events = [
        {"type": "system", "subtype": "init", "session_id": "s1"},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "WebSearch", "input": {"query": "vendors"}},
            {"type": "tool_use", "name": "WebFetch", "input": {"url": "https://x.example/"}},
            {"type": "tool_use", "name": "mcp__ledger__post_note", "input": {"claim": "c"}},
        ]}},
        {"type": "result", "subtype": "success", "is_error": False, "result": "done", "num_turns": 4, "session_id": "s1",
         "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 20},
         "total_cost_usd": 0.0123},
    ]
    for ev in events:
        ClaudeCodeRunner._consume(ev, res, lambda k, u: fetched.append((k, u)))
    assert fetched == [("search", "vendors"), ("fetch", "https://x.example/")]
    assert res.status == "ok" and res.usage.total == 135 and res.usage.cost_usd == 0.0123 and res.session_id == "s1"
    err = RunResult(status="error")
    ClaudeCodeRunner._consume({"type": "result", "subtype": "error_during_execution", "is_error": True, "result": "boom", "usage": {}}, err, None)
    assert err.status == "error" and "boom" in err.error


def test_missing_binary_is_an_error_not_a_crash(tmp_path):
    r = ClaudeCodeRunner(Config(claude_bin="/definitely/not/here"), str(tmp_path / "db"))
    res = r.run(spec())
    assert res.status == "error" and "not found" in res.error
