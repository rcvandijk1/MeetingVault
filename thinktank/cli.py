"""Command line: init, post, daemon, run, web, status, purge."""
from __future__ import annotations

import argparse
import json
import logging
import sys

from .config import load_config
from .db import init_db
from .ledger import Ledger, LedgerError
from .supervisor import Supervisor


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="thinktank", description="Research Think Tank v0.1")
    ap.add_argument("--config", help="TOML config file (default: thinktank.toml or $THINKTANK_CONFIG)")
    ap.add_argument("--db", help="SQLite path (overrides config)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create the database")
    p_post = sub.add_parser("post", help="post a problem from a JSON file (fields as in docs/baseline-template.md)")
    p_post.add_argument("file")
    p_daemon = sub.add_parser("daemon", help="run the supervisor loop")
    p_daemon.add_argument("--once", action="store_true", help="one poll, then exit")
    p_run = sub.add_parser("run", help="run one problem now, ignoring the run window")
    p_run.add_argument("problem_id")
    sub.add_parser("web", help="serve the boards")
    p_status = sub.add_parser("status", help="print problems and budget")
    p_status.add_argument("--json", action="store_true")
    p_purge = sub.add_parser("purge", help="purge every claim whose source URL starts with a prefix")
    p_purge.add_argument("url_prefix")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config(args.config)
    db = args.db or cfg.db_path

    if args.cmd == "init":
        init_db(db)
        print(f"initialised {db}")
        return 0
    if args.cmd == "post":
        init_db(db)
        with open(args.file) as f:
            data = json.load(f)
        L = Ledger(db, cfg)
        try:
            pid = L.post_problem(
                mode=data.get("mode", ""), question=data.get("question", ""), decision=data.get("decision", ""),
                must_answer=data.get("must_answer", []), evidence_standard=data.get("evidence_standard", ""),
                deliverable=data.get("deliverable", ""), token_cap=data.get("token_cap"), deadline=str(data.get("deadline", "")),
                confidential=bool(data.get("confidential", False)),
            )
        except LedgerError as e:
            print(f"rejected: {e}", file=sys.stderr)
            return 2
        print(pid)
        return 0
    if args.cmd == "daemon":
        Supervisor(cfg, db).daemon(once=args.once)
        return 0
    if args.cmd == "run":
        sup = Supervisor(cfg, db)
        p = sup.ledger.get_problem(args.problem_id)
        if p["status"] == "posted":
            sup.ledger.set_status(p["id"], "queued")
        print(sup.run_problem(args.problem_id))
        return 0
    if args.cmd == "web":
        from .web import serve
        init_db(db)
        serve(cfg, db)
        return 0
    if args.cmd == "status":
        sup = Supervisor(cfg, db)
        spend = sup.governor.spend_status()
        problems = sup.ledger.list_problems()
        if args.json:
            print(json.dumps({"spend": spend, "problems": problems}, indent=2, default=str))
        else:
            pct = f" ({spend['month_pct']}%)" if spend["month_pct"] is not None else ""
            print(f"spend, last 30 days: ${spend['month_usd']:.2f} of ${spend['max_usd_month']:.0f} max{pct}, {spend['month_tokens']:,} tokens")
            print(f"spend, last 7 days:  ${spend['week_usd']:.2f}, {spend['week_tokens']:,} tokens")
            for p in problems:
                cap = f"{p['token_cap']:,}" if p["token_cap"] > 0 else "no cap"
                print(f"{p['id']}  {p['status']:<12} {p['mode']:<9} {p['tokens_used']:>10,} / {cap:<10} {p['question'][:70]}")
        return 0
    if args.cmd == "purge":
        n = Ledger(db, cfg).purge_source(args.url_prefix)
        print(f"purged {n} claims")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
