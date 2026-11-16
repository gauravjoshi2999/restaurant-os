#!/usr/bin/env python3
"""Verify GitHub Pages really serves the exact QA-approved Bite build.

Only public GET requests; no auth, checkout, database writes or provider calls.
The file manifest is intentionally small and covers critical customer, owner,
payment-audit and delivery entrypoints plus the published commit marker.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

PUBLIC_FILES = (
    "index.html",
    "customer.html",
    "delivery.html",
    "menu-qr.html",
    "assets/admin-cashfree-audit.js",
    "assets/bite-pos-drafts.js",
    "assets/owner-capabilities.js",
    "assets/owner-hospitality.js",
    "assets/owner-hospitality.css",
    "bite-deploy-version.json",
)
MAX_BYTES = 3_000_000
DEFAULT_SITE = "https://gauravjoshi2999.github.io/restaurant-os/"


def verify_release(sha: str, site: str, dist: Path, fetch=None) -> list[str]:
    """Check the public release against local artifact bytes. Return verified paths."""
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected exact 40-character lowercase main commit SHA")
    base = site.rstrip("/") + "/"
    parsed = urlsplit(base)
    if parsed.scheme != "https" or parsed.hostname != "gauravjoshi2999.github.io" or parsed.path != "/restaurant-os/":
        raise ValueError("Refusing to probe an unknown site or non-HTTPS endpoint")
    if fetch is None:
        fetch = fetch_public
    verified = []
    for path in PUBLIC_FILES:
        source = (dist / path)
        if not source.is_file():
            raise ValueError("Expected release artifact is missing: " + path)
        expected = source.read_bytes()
        if len(expected) > MAX_BYTES:
            raise ValueError("Release artifact exceeds byte limit: " + path)
        actual = fetch(base, path, sha)
        if not isinstance(actual, bytes) or len(actual) > MAX_BYTES:
            raise ValueError("Invalid or oversized public response: " + path)
        if hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
            raise ValueError("Live Pages file differs from approved build: " + path)
        verified.append(path)
    manifest = json.loads((dist / "bite-deploy-version.json").read_text(encoding="utf-8"))
    if manifest != {"sha": sha}:
        raise ValueError("Published commit marker does not match approved SHA")
    if ('name="bite-deploy-sha" content="' + sha + '"').encode() not in (dist / "index.html").read_bytes():
        raise ValueError("Owner workspace build marker missing")
    if ('name="bite-customer-build" content="' + sha + '"').encode() not in (dist / "customer.html").read_bytes():
        raise ValueError("Customer workspace build marker missing")
    return verified


def fetch_public(base: str, path: str, sha: str) -> bytes:
    # Commit query defeats stale intermediary caches without changing app state.
    url = urljoin(base, path) + "?bite_release_check=" + sha
    req = Request(url, headers={
        "Accept": "*/*",
        "Cache-Control": "no-cache",
        "User-Agent": "Bite-Release-Attestation/1.0",
    }, method="GET")
    with urlopen(req, timeout=12) as resp:
        if resp.status != 200 or urlsplit(resp.geturl()).hostname != "gauravjoshi2999.github.io":
            raise ValueError("Unexpected public release response for " + path)
        result = resp.read(MAX_BYTES + 1)
    if len(result) > MAX_BYTES:
        raise ValueError("Oversized Pages response: " + path)
    return result


def main() -> int:
    p = argparse.ArgumentParser(description="Verify public Bite GitHub Pages release")
    p.add_argument("--sha", required=True)
    p.add_argument("--site", default=DEFAULT_SITE)
    p.add_argument("--dist", type=Path, default=Path("dist/site"))
    p.add_argument("--attempts", type=int, default=5)
    args = p.parse_args()
    if args.attempts < 1 or args.attempts > 8:
        p.error("--attempts must be between 1 and 8")
    for attempt in range(1, args.attempts + 1):
        try:
            paths = verify_release(args.sha, args.site, args.dist)
            print("PASS: Public GitHub Pages serves the exact QA-approved Bite commit:", args.sha)
            print("PASS: " + ", ".join(paths))
            return 0
        except (ValueError, OSError, URLError, HTTPError, json.JSONDecodeError) as exc:
            print(f"Attempt {attempt}/{args.attempts}: {type(exc).__name__}: {exc}", file=sys.stderr)
            if attempt == args.attempts:
                print("FAIL: GitHub Pages live release is not verified; do not claim deployed.", file=sys.stderr)
                return 1
            time.sleep(12)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
