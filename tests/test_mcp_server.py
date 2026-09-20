import io
import json

from thinktank.mcp_server import TOOLS, Context, call_tool, serve, tools_for_role

from conftest import post


def test_role_scoping(ledger):
    pid = post(ledger)
    reader = Context(role="reader", problem_id=pid, run_id="r1")
    result, err = call_tool(ledger, reader, "submit_verdict", {"deliverable_id": "x", "passed": True, "reasons": "y"})
    assert err and "not available to role reader" in result
    judge = Context(role="judge", problem_id=pid)
    result, err = call_tool(ledger, judge, "get_problem", {})
    assert err  # the judge sees the brief only
    result, err = call_tool(ledger, judge, "get_brief", {})
    assert not err and set(result) == {"mode", "question", "decision", "must_answer", "hypotheses", "evidence_standard", "deliverable"}
    names = {t.name for t in tools_for_role("reader")}
    assert names == {"get_task", "search_claims", "post_note", "finish_task", "register_self", "list_agents", "post_message", "read_inbox", "get_thread"}
    assert {t.name for t in tools_for_role("judge")} == {"get_brief", "get_deliverable", "submit_verdict"}
    assert "post_message" not in {t.name for t in tools_for_role("synthesizer")}
    assert "list_threads" in {t.name for t in tools_for_role("synthesizer")}
    assert all(t.roles for t in TOOLS.values())


def test_refusals_are_errors_not_exceptions(ledger):
    pid = post(ledger)
    reader = Context(role="reader", problem_id=pid, run_id="r1")
    result, err = call_tool(ledger, reader, "post_note", {"claim": "c", "url": "nope", "quote": "a full supporting sentence", "claim_type": "other"})
    assert err and "refused" in result
    result, err = call_tool(ledger, reader, "post_note", {"claim": "c"})
    assert err and "bad arguments" in result


def test_finish_task_requires_lease(ledger):
    pid = post(ledger)
    tid = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    ledger.lease_task(tid, "r1")
    other = Context(role="reader", problem_id=pid, run_id="r2", task_id=tid)
    result, err = call_tool(ledger, other, "finish_task", {"summary": "s"})
    assert err and "not leased" in result
    mine = Context(role="reader", problem_id=pid, run_id="r1", task_id=tid)
    _, err = call_tool(ledger, mine, "finish_task", {"summary": "s"})
    assert not err


def test_stdio_protocol_roundtrip(ledger, config, monkeypatch):
    pid = post(ledger)
    tid = ledger.create_task(pid, title="a", criteria="c", budget_tokens=10, merge_owner="lead")
    monkeypatch.setenv("THINKTANK_CONFIG", "/nonexistent.toml")
    env = {"THINKTANK_DB": config.db_path, "THINKTANK_ROLE": "reader", "THINKTANK_PROBLEM": pid, "THINKTANK_RUN": "r9", "THINKTANK_TASK": tid}
    msgs = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_task", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "submit_verdict", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 5, "method": "nope"},
    ]
    out = io.StringIO()
    serve(io.StringIO("\n".join(json.dumps(m) for m in msgs) + "\n"), out, env)
    replies = [json.loads(l) for l in out.getvalue().splitlines()]
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    assert {"get_task", "search_claims", "post_note", "finish_task", "register_self", "post_message"} <= {t["name"] for t in replies[1]["result"]["tools"]}
    assert replies[2]["result"]["isError"] is False and json.loads(replies[2]["result"]["content"][0]["text"])["task_id"] == tid
    assert replies[3]["result"]["isError"] is True
    assert replies[4]["error"]["code"] == -32601
