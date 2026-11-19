"""Offline regression tests for Bite public GitHub Pages release attestation."""
import json
import tempfile
import unittest
from pathlib import Path

from scripts.verify_live_pages import DEFAULT_SITE, PUBLIC_FILES, verify_release

SHA = "a" * 40


def create_fixture(directory: Path, sha=SHA):
    contents = {}
    for filename in PUBLIC_FILES:
        path = directory / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        if filename == "index.html":
            data = f'<meta name="bite-deploy-sha" content="{sha}">'.encode()
        elif filename == "customer.html":
            data = f'<meta name="bite-customer-build" content="{sha}">'.encode()
        elif filename == "bite-deploy-version.json":
            data = json.dumps({"sha": sha}).encode()
        else:
            data = ("public bytes for " + filename).encode()
        path.write_bytes(data)
        contents[filename] = data
    return contents


class ReleaseAttestationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dist = Path(self.temp.name)
        self.contents = create_fixture(self.dist)

    def fetch(self, site, path, sha):
        self.assertEqual(site, DEFAULT_SITE)
        self.assertEqual(sha, SHA)
        return self.contents[path]

    def test_passes_only_for_exact_published_bytes_and_sha(self):
        self.assertEqual(verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch), list(PUBLIC_FILES))

    def test_fail_closed_on_stale_cached_public_asset(self):
        self.contents["assets/admin-cashfree-audit.js"] = b"old vendor audit release"
        with self.assertRaisesRegex(ValueError, "Live Pages file differs"):
            verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)

    def test_fail_closed_on_stale_hotel_account_assets(self):
        for asset in ("assets/owner-hotel-accounts.js", "assets/owner-hotel-accounts.css"):
            with self.subTest(asset=asset):
                original = self.contents[asset]
                try:
                    self.contents[asset] = b"stale hotel account asset"
                    with self.assertRaisesRegex(ValueError, "Live Pages file differs"):
                        verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)
                finally:
                    self.contents[asset] = original

    def test_fail_closed_on_stale_owner_home_ui_assets(self):
        for asset in ("assets/owner-reference-v3.css", "assets/owner-mobile-navigation.js"):
            with self.subTest(asset=asset):
                original = self.contents[asset]
                try:
                    self.contents[asset] = b"stale owner home UI from browser cache"
                    with self.assertRaisesRegex(ValueError, "Live Pages file differs"):
                        verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)
                finally:
                    self.contents[asset] = original

    def test_fail_closed_on_stale_customer_page(self):
        self.contents["customer.html"] = b"old customer html"
        with self.assertRaisesRegex(ValueError, "customer.html"):
            verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)

    def test_rejects_wrong_build_marker_even_when_live_matches_build(self):
        (self.dist / "index.html").write_text('<meta name="bite-deploy-sha" content="__BITE_BUILD_SHA__">')
        self.contents["index.html"] = (self.dist / "index.html").read_bytes()
        with self.assertRaisesRegex(ValueError, "Owner workspace build marker missing"):
            verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)

    def test_rejects_wrong_sha_or_an_untrusted_domain(self):
        for bad in ["not-a-sha", "A" * 40, "../" + SHA]:
            with self.assertRaises(ValueError):
                verify_release(bad, DEFAULT_SITE, self.dist, self.fetch)
        with self.assertRaisesRegex(ValueError, "Refusing to probe"):
            verify_release(SHA, "http://example.com/restaurant-os/", self.dist, self.fetch)
        with self.assertRaisesRegex(ValueError, "Refusing to probe"):
            verify_release(SHA, "https://evil.example/restaurant-os/", self.dist, self.fetch)

    def test_rejects_missing_or_oversized_artifact(self):
        (self.dist / "delivery.html").unlink()
        with self.assertRaisesRegex(ValueError, "Expected release artifact is missing"):
            verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)
        (self.dist / "delivery.html").write_bytes(b"okay")
        self.contents["delivery.html"] = b"okay"
        self.contents["menu-qr.html"] = b"x" * 3_000_001
        with self.assertRaisesRegex(ValueError, "oversized public response"):
            verify_release(SHA, DEFAULT_SITE, self.dist, self.fetch)


if __name__ == "__main__":
    unittest.main()
