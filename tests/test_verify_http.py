"""The real fetcher against a local HTTP server: HTML, charset, gzip, plain
text, PDF content type, 404, and the size ceiling."""
import gzip
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from thinktank import verify
from thinktank.verify import FAIL, PASS, UNSUPPORTED, check_quote, fetch_text

PAGES = {
    "/html": ("text/html; charset=utf-8", "<html><body><script>var q='not this';</script><p>ACME charges “€10k” per seat.</p></body></html>".encode()),
    "/latin": ("text/html; charset=iso-8859-1", "<p>Zürich office opened</p>".encode("iso-8859-1")),
    "/gz": ("text/html", gzip.compress(b"<p>compressed page says hello world</p>")),
    "/txt": ("text/plain", b"plain text with the quote in it"),
    "/pdf": ("application/pdf", b"%PDF-1.4 binary"),
    "/big": ("text/html", b"x" * (verify.MAX_BYTES + 10)),
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path not in PAGES:
            self.send_response(404)
            self.end_headers()
            return
        ctype, body = PAGES[self.path]
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if self.path == "/gz":
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="module")
def base():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture(autouse=True)
def no_proxy(monkeypatch):
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")


def test_html_page(base):
    f = fetch_text(base + "/html")
    assert f.ok and f.status == 200 and "not this" not in f.text
    assert check_quote(base + "/html", 'ACME charges "€10k" per seat', fetch_text)[0] == PASS
    assert check_quote(base + "/html", "ACME charges 20k per seat", fetch_text)[0] == FAIL


def test_charset_gzip_and_plain_text(base):
    assert check_quote(base + "/latin", "Zürich office opened", fetch_text)[0] == PASS
    assert check_quote(base + "/gz", "compressed page says hello", fetch_text)[0] == PASS
    assert check_quote(base + "/txt", "with the quote in it", fetch_text)[0] == PASS


def test_pdf_big_and_missing(base):
    assert check_quote(base + "/pdf", "anything at all here", fetch_text)[0] == UNSUPPORTED
    assert check_quote(base + "/big", "anything at all here", fetch_text)[0] == UNSUPPORTED
    r, detail = check_quote(base + "/missing", "anything at all here", fetch_text)
    assert r == FAIL and "404" in detail
    r, detail = check_quote("http://127.0.0.1:1/closed", "anything at all here", fetch_text)
    assert r == FAIL and "fetch failed" in detail
