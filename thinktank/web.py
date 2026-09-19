"""Minimal local web page over SQLite: inbox board, reply board, escalation
queue, claim ledger lookup. Standard library only; no JavaScript.

Bind it to a private network address (the default is loopback). It has no
authentication, so never expose it to the internet.
"""
from __future__ import annotations

import html
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import Config
from .ledger import Ledger, LedgerError

STYLE = """
body{font:15px/1.45 system-ui,sans-serif;max-width:60rem;margin:1.5rem auto;padding:0 1rem;color:#222;background:#fafafa}
nav a{margin-right:1rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.35rem .5rem;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;background:#fff;border:1px solid #ddd;padding:.75rem}label{display:block;margin:.6rem 0 .2rem}
input[type=text],textarea,select{width:100%;padding:.4rem;font:inherit}textarea{min-height:5rem}.err{color:#a00}.ok{color:#070}
.badge{background:#eee;border-radius:.3rem;padding:.1rem .4rem;font-size:.85em}
"""


def esc(s) -> str:
    return html.escape("" if s is None else str(s))


def page(title: str, body: str) -> bytes:
    nav = '<nav><a href="/">Inbox</a><a href="/replies">Replies</a><a href="/escalations">Escalations</a><a href="/ledger">Claim ledger</a></nav>'
    return f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>{esc(title)}</title><style>{STYLE}</style></head><body>{nav}<h1>{esc(title)}</h1>{body}</body></html>".encode()


class Handler(BaseHTTPRequestHandler):
    config: Config
    db_path: str

    def log_message(self, fmt, *args):  # quieter
        pass

    def ledger(self) -> Ledger:
        return Ledger(self.db_path, self.config)

    def send_html(self, body: bytes, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, to: str) -> None:
        self.send_response(303)
        self.send_header("Location", to)
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        L = self.ledger()
        try:
            if url.path == "/":
                return self.send_html(self.inbox(L, q))
            if url.path.startswith("/problem/"):
                return self.send_html(self.problem(L, url.path.split("/", 2)[2]))
            if url.path == "/replies":
                return self.send_html(self.replies(L))
            if url.path.startswith("/reply/"):
                return self.send_html(self.reply(L, url.path.split("/", 2)[2]))
            if url.path == "/escalations":
                return self.send_html(self.escalations(L))
            if url.path == "/ledger":
                return self.send_html(self.ledger_page(L, q))
            self.send_html(page("Not found", ""), 404)
        finally:
            L.close()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        form = {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(length).decode()).items()}
        url = urllib.parse.urlparse(self.path)
        L = self.ledger()
        try:
            if url.path == "/post":
                try:
                    pid = L.post_problem(
                        mode=form.get("mode", ""), question=form.get("question", ""), decision=form.get("decision", ""),
                        must_answer=form.get("must_answer", "").splitlines(), evidence_standard=form.get("evidence_standard", ""),
                        deliverable=form.get("deliverable", ""), token_cap=int(form.get("token_cap") or 0),
                        deadline=form.get("deadline", ""), confidential=form.get("confidential") == "on",
                    )
                    return self.redirect(f"/problem/{pid}")
                except (LedgerError, ValueError) as e:
                    return self.send_html(self.inbox(L, {}, error=str(e), form=form), 400)
            if url.path.startswith("/escalation/") and url.path.endswith("/resolve"):
                L.resolve_escalation(url.path.split("/")[2])
                return self.redirect("/escalations")
            self.send_html(page("Not found", ""), 404)
        finally:
            L.close()

    # ------------------------------------------------------------ pages
    def spend_panel(self) -> str:
        """Spend status against the plan's monthly price. Shown, not enforced."""
        from .governor import Governor

        L = self.ledger()
        try:
            s = Governor(self.config, L).spend_status()
        finally:
            L.close()
        pct = s["month_pct"]
        bar = ""
        if pct is not None:
            width = max(0, min(100, pct))
            colour = "#070" if pct < 70 else "#c80" if pct < 100 else "#a00"
            bar = f"<div style='background:#ddd;height:.6rem;border-radius:.3rem;max-width:30rem'><div style='width:{width}%;height:100%;background:{colour};border-radius:.3rem'></div></div>"
        return (f"<div style='border:1px solid #ddd;background:#fff;padding:.75rem;margin-bottom:1rem'><b>Spend status</b> (API-equivalent, measured by the supervisor; no limit is enforced)<br>"
                f"Last 30 days: ${s['month_usd']:.2f} of ${s['max_usd_month']:.0f} max spending on the subscription"
                f"{f' ({pct}%)' if pct is not None else ''} · {s['month_tokens']:,} tokens<br>"
                f"Last 7 days: ${s['week_usd']:.2f} · {s['week_tokens']:,} tokens{bar}</div>")

    @staticmethod
    def tokens_cell(p: dict) -> str:
        return f"{p['tokens_used']:,}/{p['token_cap']:,}" if p["token_cap"] > 0 else f"{p['tokens_used']:,} (no cap)"

    def inbox(self, L: Ledger, q: dict, error: str = "", form: dict | None = None) -> bytes:
        form = form or {}
        rows = "".join(
            f"<tr><td><a href='/problem/{esc(p['id'])}'>{esc(p['id'])}</a></td><td>{esc(p['mode'])}</td><td>{esc(p['question'])}</td>"
            f"<td><span class=badge>{esc(p['status'])}</span></td><td>{self.tokens_cell(p)}</td><td>{esc(p['deadline'])}</td></tr>"
            for p in L.list_problems()
        )
        err = f"<p class=err>{esc(error)}</p>" if error else ""
        body = f"""
{self.spend_panel()}
<h2>Post a problem</h2>{err}
<form method=post action=/post>
<label>Mode</label><select name=mode><option value=research {'selected' if form.get('mode') != 'ideas' else ''}>research</option><option value=ideas {'selected' if form.get('mode') == 'ideas' else ''}>ideas</option></select>
<label>Question (one sentence)</label><input type=text name=question value="{esc(form.get('question'))}">
<label>Decision it feeds</label><input type=text name=decision value="{esc(form.get('decision'))}">
<label>Must-answer list (3 to 7 lines)</label><textarea name=must_answer>{esc(form.get('must_answer'))}</textarea>
<label>Evidence standard (source type and maximum age)</label><input type=text name=evidence_standard value="{esc(form.get('evidence_standard'))}">
<label>Deliverable (format and length)</label><input type=text name=deliverable value="{esc(form.get('deliverable'))}">
<label>Token cap (optional; empty means no cap, spend is shown above)</label><input type=text name=token_cap value="{esc(form.get('token_cap') or '')}">
<label>Deadline (HH:MM for the next occurrence, or ISO date-time)</label><input type=text name=deadline value="{esc(form.get('deadline') or '07:00')}">
<label><input type=checkbox name=confidential> This post contains confidential material (it will be rejected)</label>
<p><button>Post to inbox</button></p></form>
<h2>Problems</h2><table><tr><th>Id</th><th>Mode</th><th>Question</th><th>Status</th><th>Tokens</th><th>Deadline</th></tr>{rows}</table>"""
        return page("Inbox board", body)

    def problem(self, L: Ledger, pid: str) -> bytes:
        try:
            p = L.get_problem(pid)
        except LedgerError:
            return page("Not found", "")
        tasks = "".join(f"<tr><td>{esc(t['id'])}</td><td>{t['depth']}</td><td>{esc(t['title'])}</td><td><span class=badge>{esc(t['status'])}</span></td><td>{t['tokens_used']:,}/{t['budget_tokens']:,}</td><td>{esc(t['summary'])}</td></tr>" for t in L.list_tasks(pid))
        runs = "".join(f"<tr><td>{esc(r['id'])}</td><td>{esc(r['role'])}</td><td>{esc(r['model'])}</td><td><span class=badge>{esc(r['status'])}</span></td><td>{r['total_tokens']:,}</td><td>${r['cost_usd']:.3f}</td><td>{esc(r['error'])}</td></tr>" for r in L.list_runs(pid))
        notes = "".join(f"<tr><td>{esc(n['status'])}</td><td>{esc(n['claim'])}</td><td><a href='{esc(n['url'])}'>source</a> {esc(n['source_date'])}</td><td>{esc(n['quote_check'] or '-')}</td><td>{esc(n['verify_reason'])}</td></tr>" for n in L.list_notes(pid))
        fetches = "".join(f"<tr><td>{esc(f['at'])}</td><td>{esc(f['role'])}</td><td>{esc(f['kind'])}</td><td>{esc(f['url'])}</td></tr>" for f in L.list_fetches(pid))
        events = "".join(f"<tr><td>{esc(e['at'])}</td><td>{esc(e['kind'])}</td><td>{esc(e['detail'])}</td></tr>" for e in L.events(pid))
        d = L.latest_deliverable(pid)
        v = L.latest_verdict(pid)
        body = f"""
<p><span class=badge>{esc(p['status'])}</span> stage: {esc(p['stage'] or '-')} · mode: {esc(p['mode'])} · tokens {self.tokens_cell(p)} · cost ${p['cost_usd']:.2f} · deadline {esc(p['deadline'])}</p>
{f"<p class=err>{esc(p['error'])}</p>" if p['error'] else ''}
<p><b>Question:</b> {esc(p['question'])}<br><b>Decision it feeds:</b> {esc(p['decision'])}<br><b>Evidence standard:</b> {esc(p['evidence_standard'])}<br><b>Deliverable:</b> {esc(p['deliverable'])}</p>
<ol>{''.join(f'<li>{esc(m)}</li>' for m in p['must_answer'])}</ol>
{f"<h2>Verdict</h2><p class={'ok' if v['passed'] else 'err'}>{'pass' if v['passed'] else 'fail'}: {esc(v['reasons'])}</p>" if v else ''}
{f"<h2>Deliverable v{d['version']}</h2><pre>{esc(d['body'])}</pre>" if d else ''}
<h2>Subtasks</h2><table><tr><th>Id</th><th>Depth</th><th>Title</th><th>Status</th><th>Tokens</th><th>Summary</th></tr>{tasks}</table>
<h2>Notes</h2><table><tr><th>Status</th><th>Claim</th><th>Source</th><th>Quote check</th><th>Verification</th></tr>{notes}</table>
<h2>Runs</h2><table><tr><th>Id</th><th>Role</th><th>Model</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Error</th></tr>{runs}</table>
<h2>Fetch log</h2><table><tr><th>At</th><th>Role</th><th>Kind</th><th>URL or query</th></tr>{fetches}</table>
<h2>Events</h2><table><tr><th>At</th><th>Kind</th><th>Detail</th></tr>{events}</table>"""
        return page(f"Problem {pid}", body)

    def replies(self, L: Ledger) -> bytes:
        rows = "".join(f"<tr><td>{esc(r['created_at'])}</td><td><a href='/reply/{esc(r['id'])}'>{esc(r['problem_id'])}</a></td><td>{r['tokens']:,}</td><td>${r['cost_usd']:.2f}</td></tr>" for r in L.list_replies())
        return page("Reply board", f"<table><tr><th>Posted</th><th>Problem</th><th>Tokens</th><th>Cost</th></tr>{rows}</table>")

    def reply(self, L: Ledger, rid: str) -> bytes:
        r = L.get_reply(rid)
        if not r:
            return page("Not found", "")
        return page(f"Reply for {r['problem_id']}", f"<p><a href='/problem/{esc(r['problem_id'])}'>problem</a></p><pre>{esc(r['body'])}</pre>")

    def escalations(self, L: Ledger) -> bytes:
        items = "".join(
            f"<h2><a href='/problem/{esc(e['problem_id'])}'>{esc(e['problem_id'])}</a> <span class=badge>{esc(e['created_at'])}</span></h2>"
            f"<p class=err>{esc(e['reason'])}</p><pre>{esc(e['partial'])}</pre>"
            f"<form method=post action='/escalation/{esc(e['id'])}/resolve'><button>Mark resolved</button></form>"
            for e in L.list_escalations()
        )
        return page("Escalation queue", items or "<p>Nothing waiting.</p>")

    def ledger_page(self, L: Ledger, q: dict) -> bytes:
        query = (q.get("q") or [""])[0]
        rows = ""
        if query:
            for c in L.search_claims(query, limit=50, include_expired=True):
                rows += f"<tr><td>{esc(c['claim'])}</td><td><a href='{esc(c['source_url'])}'>source</a> {esc(c['source_date'])}</td><td>{esc(c['claim_type'])}</td><td>{'expired' if c['expired'] else esc(c['expires_at'] or 'never')}</td><td>{'yes' if c['single_source'] else 'no'}</td><td>{'yes' if c['quote_checked'] else 'no'}</td></tr>"
        body = f"<form><input type=text name=q value='{esc(query)}' placeholder='search verified claims'></form><table><tr><th>Claim</th><th>Source</th><th>Type</th><th>Expires</th><th>Single source</th><th>Quote machine-checked</th></tr>{rows}</table>"
        return page("Claim ledger", body)


def serve(config: Config, db_path: str) -> None:
    Handler.config = config
    Handler.db_path = db_path
    srv = ThreadingHTTPServer((config.web_host, config.web_port), Handler)
    print(f"think tank board on http://{config.web_host}:{config.web_port}/")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def render_json(obj) -> str:
    return json.dumps(obj, indent=2, default=str)
