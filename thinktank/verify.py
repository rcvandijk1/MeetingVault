"""Mechanical quote verification: no LLM involved.

A reader's note says "this quote is on that page". Whether that is true is a
substring test, not a judgement, so the supervisor fetches the page itself
and checks. Only notes that pass reach the critic, whose job shrinks to what
needs judgement: the date and whether the quote in context supports the
claim. This closes the largest path by which a hallucinated quote could
enter the claim ledger.
"""
from __future__ import annotations

import gzip
import re
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser

USER_AGENT = "thinktank-verifier/0.1 (+quote check)"
MAX_BYTES = 3_000_000
TIMEOUT = 25

PASS, FAIL, UNSUPPORTED = "pass", "fail", "unsupported"


@dataclass
class Fetched:
    ok: bool
    text: str = ""
    content_type: str = ""
    status: int = 0
    error: str = ""


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "section", "article"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        else:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(raw: str) -> str:
    p = _TextExtractor()
    try:
        p.feed(raw)
        p.close()
    except Exception:  # malformed markup: use what was parsed
        pass
    return " ".join(p.parts)


_QUOTES = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " ", "…": "..."}


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    for a, b in _QUOTES.items():
        s = s.replace(a, b)
    s = s.lower()
    return re.sub(r"\s+", " ", s).strip()


def loose(s: str) -> str:
    """Letters and digits only: survives punctuation and hyphenation differences."""
    return re.sub(r"[^a-z0-9]+", "", normalize(s))


def quote_in_text(quote: str, text: str) -> bool:
    q, t = normalize(quote), normalize(text)
    if not q:
        return False
    if q in t:
        return True
    lq = loose(quote)
    return len(lq) >= 12 and lq in loose(text)


def fetch_text(url: str) -> Fetched:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            status = resp.status
            ctype = (resp.headers.get("Content-Type") or "").lower()
            raw = resp.read(MAX_BYTES + 1)
            if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
    except urllib.error.HTTPError as e:
        return Fetched(ok=False, status=e.code, error=f"HTTP {e.code}")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        return Fetched(ok=False, error=f"fetch failed: {e}")
    if len(raw) > MAX_BYTES:
        return Fetched(ok=False, status=status, content_type=ctype, error="page larger than the verifier reads")
    if "html" in ctype or "xml" in ctype or not ctype:
        charset = "utf-8"
        m = re.search(r"charset=([\w\-]+)", ctype)
        if m:
            charset = m.group(1)
        try:
            body = raw.decode(charset, errors="replace")
        except LookupError:
            body = raw.decode("utf-8", errors="replace")
        return Fetched(ok=True, text=html_to_text(body), content_type=ctype, status=status)
    if ctype.startswith("text/"):
        return Fetched(ok=True, text=raw.decode("utf-8", errors="replace"), content_type=ctype, status=status)
    return Fetched(ok=False, status=status, content_type=ctype, error=f"unsupported content type {ctype.split(';')[0]}")


def check_quote(url: str, quote: str, fetcher=fetch_text) -> tuple[str, str]:
    """Returns (PASS|FAIL|UNSUPPORTED, detail)."""
    f = fetcher(url)
    if not f.ok:
        if f.error.startswith("unsupported content type") or f.error.startswith("page larger"):
            return UNSUPPORTED, f.error
        return FAIL, f.error or "fetch failed"
    if quote_in_text(quote, f.text):
        return PASS, f"quote found on page (HTTP {f.status})"
    return FAIL, f"quote not found on page (HTTP {f.status}, {len(f.text)} chars of text)"
