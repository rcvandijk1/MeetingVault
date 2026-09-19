from thinktank.governor import Governor
from thinktank.config import Config
from thinktank.verify import FAIL, PASS, UNSUPPORTED, Fetched, check_quote, html_to_text, quote_in_text


def test_html_to_text_drops_scripts_and_keeps_words():
    raw = "<html><head><style>p{}</style><script>var x='hidden quote';</script></head><body><h1>Title</h1><p>ACME&nbsp;charges &euro;10k per <b>seat</b>.</p></body></html>"
    text = html_to_text(raw)
    assert "hidden quote" not in text and "p{}" not in text
    assert quote_in_text("ACME charges €10k per seat", text)


def test_quote_matching_tolerates_typography_and_whitespace():
    page = "In 2026 the vendor said: “We now serve 12 broadcasters — including two\n  in Spain”."
    assert quote_in_text('"We now serve 12 broadcasters - including two in Spain"', page)
    assert quote_in_text("we NOW serve 12 broadcasters", page)
    assert quote_in_text("serve12broadcasters including", page)  # loose match, punctuation-free
    assert not quote_in_text("serve 13 broadcasters", page)
    assert not quote_in_text("", page)
    assert not quote_in_text("serve, 12", "serve 12 broadcasters")  # loose match needs 12 letters; exact fails on punctuation


def test_check_quote_outcomes():
    ok = lambda url: Fetched(ok=True, text="The quick brown fox.", content_type="text/html", status=200)
    assert check_quote("https://x/", "quick brown fox", ok)[0] == PASS
    assert check_quote("https://x/", "slow red fox", ok)[0] == FAIL
    http404 = lambda url: Fetched(ok=False, status=404, error="HTTP 404")
    assert check_quote("https://x/", "anything", http404) == (FAIL, "HTTP 404")
    pdf = lambda url: Fetched(ok=False, status=200, content_type="application/pdf", error="unsupported content type application/pdf")
    assert check_quote("https://x/", "anything", pdf)[0] == UNSUPPORTED
    big = lambda url: Fetched(ok=False, status=200, error="page larger than the verifier reads")
    assert check_quote("https://x/", "anything", big)[0] == UNSUPPORTED


def test_governor_without_caps(tmp_path):
    from thinktank.db import init_db
    from thinktank.ledger import Ledger
    cfg = Config(db_path=str(tmp_path / "g.sqlite3"))
    init_db(cfg.db_path)
    g = Governor(cfg, Ledger(cfg.db_path, cfg))
    p = {"token_cap": 0, "tokens_used": 99_999_999, "deadline": "2999-01-01T00:00:00+00:00"}
    assert g.stop_reason(p) is None and g.remaining_tokens(p) is None
    assert g.run_max_usd(p, "opus") == cfg.max_usd_per_run
    assert g.run_max_usd(p, "haiku", slice_tokens=100_000) == 0.2
    cfg.max_usd_per_run = 0
    assert g.run_max_usd(p, "opus") == 0.0
    capped = {"token_cap": 100, "tokens_used": 100, "deadline": "2999-01-01T00:00:00+00:00"}
    assert "token cap" in g.stop_reason(capped)
