#!/usr/bin/env python3
"""Discover the public Google OAuth audience from Bite's existing provider.
Do not follow redirects, sign in, exchange tokens, or print provider state.
"""
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "https://wedbgpybbgsszcmffoha.supabase.co"
CUSTOMER = "https://gauravjoshi2999.github.io/restaurant-os/customer.html"
CLIENT_ID = re.compile(r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def parse_google_redirect(location):
    parsed = urllib.parse.urlsplit(location)
    if (parsed.scheme != "https" or parsed.hostname != "accounts.google.com"
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.path not in ("/o/oauth2/v2/auth", "/o/oauth2/auth")):
        raise ValueError("Unexpected Google OAuth authorization destination")
    params = urllib.parse.parse_qs(parsed.query)
    audience = params.get("client_id", [])
    callbacks = params.get("redirect_uri", [])
    if len(audience) != 1 or not CLIENT_ID.fullmatch(audience[0]):
        raise ValueError("Google public OAuth client ID unavailable")
    if callbacks != [PROJECT + "/auth/v1/callback"]:
        raise ValueError("Unexpected Supabase Google callback")
    return audience[0]

def discover():
    url = PROJECT + "/auth/v1/authorize?" + urllib.parse.urlencode({
        "provider": "google", "redirect_to": CUSTOMER,
    })
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, method="GET"), timeout=15):
            raise ValueError("Expected a Google OAuth redirect")
    except urllib.error.HTTPError as exc:
        if exc.code not in (302, 303, 307, 308):
            raise ValueError("Existing Google provider unavailable") from None
        return parse_google_redirect(exc.headers.get("Location", ""))

def main():
    try:
        live_id = discover()
        configured_id = os.environ.get("BITE_GOOGLE_WEB_CLIENT_ID", "").strip()
        if configured_id and configured_id != live_id:
            raise ValueError("Configured Google Web client does not match the live provider")
        env_path = os.environ.get("GITHUB_ENV")
        if not env_path:
            raise ValueError("Run in a controlled GitHub Actions job")
        with open(env_path, "a", encoding="utf-8") as env_file:
            env_file.write("BITE_GOOGLE_WEB_CLIENT_ID=" + live_id + "\n")
        print("Verified existing Bite Google OAuth Web client and exact Supabase callback.")
    except Exception:
        print("Google OAuth provider preflight failed; check Bite Google provider and repository variable.", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
