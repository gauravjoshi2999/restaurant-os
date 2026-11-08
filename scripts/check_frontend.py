#!/usr/bin/env python3
"""Bite static release checks: inline JavaScript syntax + critical product guards."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile

FILES = ("customer.html", "index.html", "delivery.html")

class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.parts = []
        self.current = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            self.in_script = True
            self.current = []
    def handle_data(self, data):
        if self.in_script:
            self.current.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.in_script:
            code = "".join(self.current).strip()
            if code:
                self.parts.append(code)
            self.in_script = False
            self.current = []

def check(condition, message):
    if not condition:
        raise SystemExit("FAIL: " + message)
    print("PASS: " + message)

for filename in FILES:
    path = Path(filename)
    source = path.read_text(encoding="utf-8")
    parser = Scripts()
    parser.feed(source)
    for index, code in enumerate(parser.parts, 1):
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as temp:
            temp.write(code)
            temp.flush()
            result = subprocess.run(["node", "--check", temp.name], text=True, capture_output=True)
            if result.returncode:
                raise SystemExit(f"FAIL: {filename} inline script {index}\n{result.stderr}")
    check(bool(parser.parts), f"{filename}: inline scripts parsed by Node")

customer = Path("customer.html").read_text(encoding="utf-8")
owner = Path("index.html").read_text(encoding="utf-8")
delivery = Path("delivery.html").read_text(encoding="utf-8")

check("list_public_restaurants" in customer and "place_customer_order" in customer,
      "Customer discovery and guarded checkout RPCs are wired")
check("payment setup pending" in customer.lower() or "payment provider" in customer.lower(),
      "Customer checkout fails closed while no approved payment provider is configured")
check("const ownerPages=['overview','orders','menu','expenses','reports','settings']" in owner,
      "Owner navigation is restricted to the approved initial-release modules")
check("This account is linked to more than one restaurant" in owner,
      "Ambiguous multi-restaurant Owner accounts are blocked")
check("data-owner-dashboard" in owner and "data-platform-dashboard" in owner,
      "Owner and Platform Admin workspaces are separate")
check("setRestaurantApproval" in owner and "onboardingStatus" in owner,
      "Platform Admin has explicit restaurant approve/reject/suspend/reactivate controls")
check("access.role==='owner'&&!['overview','orders','menu','expenses','reports','settings'].includes(id)" in owner,
      "Owner route guard blocks legacy POS, stock, tables, khata and HR pages")
check("Manual POS / offline order entry Bite ke initial marketplace version mein enabled nahi hai." in owner,
      "Legacy manual POS order creation is disabled in the marketplace MVP")
check("deliveryType:x.delivery_type" in owner and "shareDeliveryHandoff" in owner,
      "Owner order model carries delivery type for delivery handoff actions")
check("isDemo:!!x.is_demo" in owner and "biteDemoBanner" in owner,
      "Simulated order records are explicitly marked in the Owner workspace")
check("get_delivery_handoff" in delivery and "confirm_delivery_handoff" in delivery,
      "Delivery link and OTP confirmation RPCs are wired")
for filename, source in (("customer.html", customer), ("index.html", owner), ("delivery.html", delivery)):
    check("service_role" not in source.lower() and "sb_secret_" not in source,
          f"{filename}: no service-role or Supabase secret key literal exposed")
print("Bite static QA passed.")
