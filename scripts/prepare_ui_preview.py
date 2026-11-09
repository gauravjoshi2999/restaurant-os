"""Build local-only, data-free layout previews from the actual application markup.

These pages do not load application scripts, authenticate or write business data.
They are generated in ignored dist/qa and are never part of the source release.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'qa'
OUT.mkdir(parents=True, exist_ok=True)


def without_scripts(source):
    source = re.sub(r'<script\b[^>]*>.*?</script>', '', source, flags=re.S | re.I)
    return source.replace('<head>', '<head><base href="../">', 1)


customer = without_scripts((ROOT / 'customer.html').read_text())
customer = customer.replace('<body data-bite-app="customer">', '<body data-bite-app="customer" data-view="account">')
customer = customer.replace('<section id="homeView">', '<section id="homeView" class="hidden">')
customer = customer.replace('<section id="accountView" class="hidden"', '<section id="accountView"')
customer = customer.replace('Account details load ho rahe hain...', '<strong>Account layout preview</strong><div>No account or business data is loaded.</div>')
customer = customer.replace('Addresses load ho rahe hain...', 'No saved addresses in this layout preview.')
customer = customer.replace('Support requests load ho rahe hain...', 'No support requests in this layout preview.')
customer = customer.replace('<button class="active" data-nav="home">', '<button data-nav="home">')
customer = customer.replace('<button data-nav="account">', '<button class="active" data-nav="account">')
(OUT / 'account-layout.html').write_text(customer)
(OUT / 'mobile-account.html').write_text('''<!doctype html><html><head><meta charset="utf-8"><title>Bite Account mobile layout preview</title><style>*{box-sizing:border-box}body{margin:0;background:#dde1e8;min-height:100vh;padding:24px;display:grid;place-items:start center}iframe{display:block;width:390px;height:844px;border:0;background:#f1f2f5;border-radius:14px;box-shadow:0 12px 40px #25293622}</style></head><body><iframe id="phonePreview" title="Account mobile layout preview" src="account-layout.html"></iframe></body></html>''')

owner = without_scripts((ROOT / 'index.html').read_text())
owner = owner.replace('<body data-bite-app="workspace">', '<body data-bite-app="workspace" data-role="owner">')
owner = owner.replace('id="authScreen"', 'id="authScreen" style="display:none"', 1)
owner = owner.replace('id="mainApp" style="display:none"', 'id="mainApp" style="display:grid"', 1)
owner = owner.replace('data-owner-dashboard class="od-home" style="display:none"', 'data-owner-dashboard class="od-home" style="display:block"', 1)
owner = owner.replace('<div data-platform-dashboard>', '<div data-platform-dashboard hidden style="display:none">', 1)
owner = owner.replace('id="ownerHomeSubtitle">', 'id="ownerHomeSubtitle">Layout preview · No business data. ', 1)
(OUT / 'owner-layout.html').write_text(owner)
print('Prepared local-only Account and Owner layout previews.')
