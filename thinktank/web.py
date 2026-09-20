"""Minimal local web page over SQLite: inbox board, reply board, escalation
queue, claim ledger lookup, and an attention signal for the tab you keep
open on your laptop. Standard library only.

Attention is a pull, not a push: the page polls `/api/attention` on the
box every 30 seconds and shows a badge in the tab title and favicon; with
permission, and on https or localhost, it also raises a desktop
notification. Nothing leaves the box unasked.

Bind it to a private network address (the default is loopback). It has no
authentication, so never expose it to the internet.
"""
from __future__ import annotations

import html
import json
import ssl
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
#attention{border:1px solid #ddd;background:#fff;padding:.6rem .75rem;margin:.5rem 0 1rem;border-radius:.4rem}
#attention.hot{border-color:#c00;background:#fff4f4}#attention.dead{border-color:#c80;background:#fff8ec}
#attention ul{margin:.3rem 0 0 1.1rem;padding:0}.unread{font-weight:bold}
"""

# The attention script: badge in the title and favicon, optional desktop
# notification, and the banner at the top of every page.
SCRIPT = """
(function(){
  var NAME = document.title.replace(/^\\(\\S+\\) /, '');
  var last = null;
  function favicon(n, dead){
    var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d');
    x.fillStyle = dead ? '#c80' : (n ? '#c00' : '#2a7'); x.beginPath(); x.arc(16,16,14,0,7); x.fill();
    if (n){ x.fillStyle='#fff'; x.font='bold 18px sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(n>9?'9+':String(n),16,17); }
    var l = document.querySelector("link[rel='icon']") || document.createElement('link'); l.rel='icon'; l.href=c.toDataURL(); document.head.appendChild(l);
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function render(a){
    var el = document.getElementById('attention'); if (!el) return;
    el.className = a.daemon_alive ? (a.count ? 'hot' : '') : 'dead';
    var h = '<b>' + esc(a.name) + '</b> · supervisor ' + (a.daemon_alive ? esc(a.daemon_status) : '<span class=err>not running</span>');
    if (a.running.length) h += ' · working on ' + a.running.map(function(r){ return '<a href="/problem/' + esc(r.id) + '">' + esc(r.question) + '</a> (' + esc(r.stage||r.status) + ')'; }).join(', ');
    if (a.queued) h += ' · ' + a.queued + ' queued';
    if (a.deferred.length) h += ' · ' + a.deferred.length + ' paused after a rate limit';
    if (a.count){ h += '<ul>' + a.items.map(function(i){ return '<li><a href="' + esc(i.href) + '">' + esc(i.text) + '</a></li>'; }).join('') + '</ul>'; }
    else h += ' · nothing needs you';
    if (window.Notification && Notification.permission !== 'granted') h += ' · <a href="#" onclick="enableNotifications();return false">enable desktop notifications</a>';
    el.innerHTML = h;
  }
  function poll(){
    fetch('/api/attention', {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(a){
      document.title = (a.count ? '(' + a.count + ') ' : (a.daemon_alive ? '' : '(down) ')) + NAME;
      favicon(a.count, !a.daemon_alive); render(a);
      if (last !== null && a.count > last && window.Notification && Notification.permission === 'granted'){
        new Notification(a.name + ' needs attention', {body: a.items.slice(0,3).map(function(i){ return i.text; }).join('\\n')});
      }
      last = a.count;
    }).catch(function(){ document.title = '(offline) ' + NAME; favicon(0, true); });
  }
  window.enableNotifications = function(){
    if (!window.Notification){ alert('This browser has no notification support.'); return; }
    if (!window.isSecureContext){ alert('Desktop notifications need https or localhost. The tab badge still works.'); return; }
    Notification.requestPermission().then(function(p){ if (p === 'granted') new Notification(NAME, {body: 'Notifications on'}); poll(); });
  };
  poll(); setInterval(poll, 30000);
})();
"""


def esc(s) -> str:
    return html.escape("" if s is None else str(s))


def page(title: str, body: str, name: str) -> bytes:
    nav = '<nav><a href="/">Inbox</a><a href="/replies">Replies</a><a href="/escalations">Escalations</a><a href="/ledger">Claim ledger</a></nav>'
    return (f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{esc(name)} · {esc(title)}</title><style>{STYLE}</style></head><body>{nav}"
            f"<div id=attention>{esc(name)} · checking…</div><h1>{esc(title)}</h1>{body}<script>{SCRIPT}</script></body></html>").encode()


class Handler(BaseHTTPRequestHandler):
    config: Config
    db_path: str

    def log_message(self, fmt, *args):  # quieter
        pass

    def ledger(self) -> Ledger:
        return Ledger(self.db_path, self.config)

    def page(self, title: str, body: str) -> bytes:
        return page(title, body, self.config.system_name)

    def send_html(self, body: bytes, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj) -> None:
        body = json.dumps(obj, default=str).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
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
            if url.path == "/api/attention":
                return self.send_json(L.attention())
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
            self.send_html(self.page("Not found", ""), 404)
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
                        hypotheses=form.get("hypotheses", "").splitlines(),
                    )
                    return self.redirect(f"/problem/{pid}")
                except (LedgerError, ValueError) as e:
                    return self.send_html(self.inbox(L, {}, error=str(e), form=form), 400)
            if url.path.startswith("/escalation/") and url.path.endswith("/resolve"):
                L.resolve_escalation(url.path.split("/")[2])
                return self.redirect("/escalations")
            if url.path == "/replies/seen":
                L.mark_reply_seen(None)
                return self.redirect("/replies")
            self.send_html(self.page("Not found", ""), 404)
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
<label>Hypotheses (optional, up to 5 lines): your own proposed answers. Readers look for evidence against them; the deliverable gives each a verdict</label><textarea name=hypotheses>{esc(form.get('hypotheses'))}</textarea>
<label>Evidence standard (source type and maximum age)</label><input type=text name=evidence_standard value="{esc(form.get('evidence_standard'))}">
<label>Deliverable (format and length)</label><input type=text name=deliverable value="{esc(form.get('deliverable'))}">
<label>Token cap (optional; empty means no cap, spend is shown above)</label><input type=text name=token_cap value="{esc(form.get('token_cap') or '')}">
<label>Deadline (HH:MM for the next occurrence, or ISO date-time)</label><input type=text name=deadline value="{esc(form.get('deadline') or '07:00')}">
<label><input type=checkbox name=confidential> This post contains confidential material (it will be rejected)</label>
<p><button>Post to inbox</button></p></form>
<h2>Problems</h2><table><tr><th>Id</th><th>Mode</th><th>Question</th><th>Status</th><th>Tokens</th><th>Deadline</th></tr>{rows}</table>"""
        return self.page("Inbox board", body)

    ROLE_COLOURS = {"reader": "#e8f1fb", "lead": "#fbefe0", "thinker": "#eef8e6", "critic": "#fbe8e8", "synthesizer": "#f1e8fb"}

    def conversations(self, L: Ledger, pid: str) -> str:
        """Every thread as a message feed. Each bubble is a real message on
        the board, attributed to the agent that posted it."""
        threads = L.list_threads(pid)
        if not threads:
            return "<p>No messages between agents.</p>"
        out = []
        for th in threads:
            state = "open" if th["status"] == "open" else f"closed: {esc(th['closed_reason'])}"
            bubbles = ""
            for m in th["messages"]:
                colour = self.ROLE_COLOURS.get(m["from_role"], "#eee")
                to = f" → {esc(L.get_agent(m['to_agent'])['name'])}" if m["to_agent"] else (f" → topics {esc(m['topics'])}" if m["topics"] else "")
                refs = f"<br><small>refs: {esc(', '.join(m['refs']))}</small>" if m["refs"] else ""
                bubbles += (f"<div style='background:{colour};border-radius:.6rem;padding:.5rem .75rem;margin:.35rem 0;max-width:46rem'>"
                            f"<b>{esc(m['from_name'])}</b> <span class=badge>{esc(m['kind'])}</span>{to} <small>{esc(m['created_at'])}</small>"
                            f"<br>{esc(m['body'])}{refs}</div>")
            arts = f"<small>artefacts: {esc(', '.join(th['artefacts']))}</small>" if th["artefacts"] else ""
            out.append(f"<details open><summary><b>{esc(th['subject'])}</b> · {len(th['messages'])} messages · {th['tokens_used']:,}/{th['budget_tokens']:,} tokens · {state}</summary>{bubbles}{arts}</details>")
        return "".join(out)

    def problem(self, L: Ledger, pid: str) -> bytes:
        try:
            p = L.get_problem(pid)
        except LedgerError:
            return self.page("Not found", "")
        tasks = "".join(f"<tr><td>{esc(t['id'])}</td><td>{t['depth']}</td><td>{esc(t['title'])}</td><td><span class=badge>{esc(t['status'])}</span></td><td>{t['tokens_used']:,}/{t['budget_tokens']:,}</td><td>{esc(t['summary'])}</td></tr>" for t in L.list_tasks(pid))
        runs = "".join(f"<tr><td>{esc(r['id'])}</td><td>{esc(r['role'])}</td><td>{esc(r['model'])}</td><td><span class=badge>{esc(r['status'])}</span></td><td>{r['total_tokens']:,}</td><td>${r['cost_usd']:.3f}</td><td>{esc(r['error'])}</td></tr>" for r in L.list_runs(pid))
        notes = "".join(f"<tr><td>{esc(n['status'])}</td><td>{esc(n['claim'])}</td><td><a href='{esc(n['url'])}'>source</a> {esc(n['source_date'])}</td><td>{esc(n['quote_check'] or '-')}</td><td>{esc(n['verify_reason'])}</td></tr>" for n in L.list_notes(pid))
        fetches = "".join(f"<tr><td>{esc(f['at'])}</td><td>{esc(f['role'])}</td><td>{esc(f['kind'])}</td><td>{esc(f['url'])}</td></tr>" for f in L.list_fetches(pid))
        events = "".join(f"<tr><td>{esc(e['at'])}</td><td>{esc(e['kind'])}</td><td>{esc(e['detail'])}</td></tr>" for e in L.events(pid))
        d = L.latest_deliverable(pid)
        v = L.latest_verdict(pid)
        agents = L.list_agents(pid, alive_only=False)
        agent_rows = "".join(
            f"<tr><td>{esc(a['name'])}</td><td>{esc(a['role'])}</td><td>{esc(', '.join(a['topics']))}</td><td>{esc(a['brief'])}</td>"
            f"<td><span class=badge>{esc(a['status'])}</span>{' · registered' if a['registered'] else ''}</td><td>{a['wakes']}</td><td>{a['tokens_used']:,}</td></tr>"
            for a in agents)
        conversations = self.conversations(L, pid)
        body = f"""
<p><span class=badge>{esc(p['status'])}</span> stage: {esc(p['stage'] or '-')} · mode: {esc(p['mode'])} · tokens {self.tokens_cell(p)} · cost ${p['cost_usd']:.2f} · deadline {esc(p['deadline'])}</p>
{f"<p class=err>{esc(p['error'])}</p>" if p['error'] else ''}
<p><b>Question:</b> {esc(p['question'])}<br><b>Decision it feeds:</b> {esc(p['decision'])}<br><b>Evidence standard:</b> {esc(p['evidence_standard'])}<br><b>Deliverable:</b> {esc(p['deliverable'])}</p>
<ol>{''.join(f'<li>{esc(m)}</li>' for m in p['must_answer'])}</ol>
{f"<p><b>Hypotheses:</b></p><ol>{''.join(f'<li>{esc(h)}</li>' for h in p['hypotheses'])}</ol>" if p['hypotheses'] else ''}
{self.plan_review(L, pid)}
{f"<h2>Verdict</h2><p class={'ok' if v['passed'] else 'err'}>{'pass' if v['passed'] else 'fail'}: {esc(v['reasons'])}</p>" if v else ''}
{f"<h2>Deliverable v{d['version']}</h2><pre>{esc(d['body'])}</pre>" if d else ''}
<h2>Conversations</h2>{conversations}
<h2>Agent index</h2><table><tr><th>Name</th><th>Role</th><th>Topics</th><th>Brief</th><th>Status</th><th>Wakes</th><th>Tokens</th></tr>{agent_rows}</table>
<h2>Subtasks</h2><table><tr><th>Id</th><th>Depth</th><th>Title</th><th>Status</th><th>Tokens</th><th>Summary</th></tr>{tasks}</table>
<h2>Notes</h2><table><tr><th>Status</th><th>Claim</th><th>Source</th><th>Quote check</th><th>Verification</th></tr>{notes}</table>
<h2>Runs</h2><table><tr><th>Id</th><th>Role</th><th>Model</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Error</th></tr>{runs}</table>
<h2>Fetch log</h2><table><tr><th>At</th><th>Role</th><th>Kind</th><th>URL or query</th></tr>{fetches}</table>
<h2>Events</h2><table><tr><th>At</th><th>Kind</th><th>Detail</th></tr>{events}</table>"""
        return self.page(f"Problem {pid}", body)

    def plan_review(self, L: Ledger, pid: str) -> str:
        reviews = L.list_critiques(pid, "plan")
        if not reviews:
            return ""
        r = reviews[0]
        items = "".join(f"<li>{esc(o.get('task_id') or o.get('must_answer_item') or o.get('hypothesis'))}: {esc(o['objection'])}</li>" for o in r["objections"])
        return f"<h2>Plan review</h2><p>{esc(r['body'])}</p>" + (f"<ul>{items}</ul>" if items else "<p class=ok>No objections; the plan stood.</p>")

    def replies(self, L: Ledger) -> bytes:
        rows = "".join(
            f"<tr class='{'unread' if not r['seen_at'] else ''}'><td>{esc(r['created_at'])}</td><td><a href='/reply/{esc(r['id'])}'>{esc(r['problem_id'])}</a></td>"
            f"<td>{esc(L.get_problem(r['problem_id'])['question'][:80])}</td><td>{r['tokens']:,}</td><td>${r['cost_usd']:.2f}</td><td>{'new' if not r['seen_at'] else esc(r['seen_at'])}</td></tr>"
            for r in L.list_replies())
        body = (f"<form method=post action=/replies/seen><button>Mark all as read</button></form>"
                f"<table><tr><th>Posted</th><th>Problem</th><th>Question</th><th>Tokens</th><th>Cost</th><th>Read</th></tr>{rows}</table>")
        return self.page("Reply board", body)

    def reply(self, L: Ledger, rid: str) -> bytes:
        r = L.get_reply(rid)
        if not r:
            return self.page("Not found", "")
        L.mark_reply_seen(rid)  # opening it is reading it
        return self.page(f"Reply for {r['problem_id']}", f"<p><a href='/problem/{esc(r['problem_id'])}'>problem</a></p><pre>{esc(r['body'])}</pre>")

    def escalations(self, L: Ledger) -> bytes:
        items = "".join(
            f"<h2><a href='/problem/{esc(e['problem_id'])}'>{esc(e['problem_id'])}</a> <span class=badge>{esc(e['created_at'])}</span></h2>"
            f"<p class=err>{esc(e['reason'])}</p><pre>{esc(e['partial'])}</pre>"
            f"<form method=post action='/escalation/{esc(e['id'])}/resolve'><button>Mark resolved</button></form>"
            for e in L.list_escalations()
        )
        return self.page("Escalation queue", items or "<p>Nothing waiting.</p>")

    def ledger_page(self, L: Ledger, q: dict) -> bytes:
        query = (q.get("q") or [""])[0]
        rows = ""
        if query:
            for c in L.search_claims(query, limit=50, include_expired=True):
                rows += f"<tr><td>{esc(c['claim'])}</td><td><a href='{esc(c['source_url'])}'>source</a> {esc(c['source_date'])}</td><td>{esc(c['claim_type'])}</td><td>{'expired' if c['expired'] else esc(c['expires_at'] or 'never')}</td><td>{'yes' if c['single_source'] else 'no'}</td><td>{'yes' if c['quote_checked'] else 'no'}</td></tr>"
        body = f"<form><input type=text name=q value='{esc(query)}' placeholder='search verified claims'></form><table><tr><th>Claim</th><th>Source</th><th>Type</th><th>Expires</th><th>Single source</th><th>Quote machine-checked</th></tr>{rows}</table>"
        return self.page("Claim ledger", body)


def serve(config: Config, db_path: str) -> None:
    Handler.config = config
    Handler.db_path = db_path
    srv = ThreadingHTTPServer((config.web_host, config.web_port), Handler)
    scheme = "http"
    if config.web_tls_cert and config.web_tls_key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(config.web_tls_cert, config.web_tls_key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        scheme = "https"
    print(f"{config.system_name} board on {scheme}://{config.web_host}:{config.web_port}/")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
