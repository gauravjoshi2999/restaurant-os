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

check('id="addrSave"' in customer and "data-aedit" in customer and "data-adelete" in customer and "data-adefault" in customer,
      "Customer can independently save, edit, delete and choose a default address")
check("customer_addresses" in customer and "addrError" in customer,
      "Customer address book is connected to Supabase with visible error handling")
check("resetPasswordForEmail" in customer and "PASSWORD_RECOVERY" in customer and "updateUser({password})" in customer,
      "Customer forgot-password email and recovery-session password update are wired")
check("customerSupportForm" in customer and "customer_support_tickets" in customer and "loadCustomerSupportTickets" in customer,
      "Customer can create and track support tickets from the Account page")
check("restaurantReviews" in customer and "restaurant_review_reports" in customer and "data-report-review" in customer,
      "Customer can read published restaurant reviews and report inappropriate reviews")
check("const platformPages=['overview','restaurants','orders','financials','audit','support','moderation']" in owner and "loadReviewReportsWorkspace" in owner and "admin_review_review_report" in owner,
      "Platform Admin can moderate customer review reports")
review_report_migration = Path("supabase/20261108190000_bite_customer_review_reporting.sql").read_text(encoding="utf-8")
check("ENABLE ROW LEVEL SECURITY" in review_report_migration and "Customers report published reviews" in review_report_migration and "Hide Review" in review_report_migration,
      "Review reporting is customer-owned and Admin moderation is guarded")
check("const platformPages=['overview','restaurants','orders','financials','audit','support','moderation']" in owner and "loadSupportWorkspace" in owner and "saveSupportTicket" in owner,
      "Platform Admin has a customer support queue with status and reply controls")
support_migration = Path("supabase/20261108140000_bite_customer_support_tickets.sql").read_text(encoding="utf-8")
check("ENABLE ROW LEVEL SECURITY" in support_migration and "Customers and admins read support tickets" in support_migration and "audit_support_ticket_change" in support_migration,
      "Support tickets are tenant-scoped and their lifecycle is audit logged")
check("if(!recovery&&(!email.includes('@')" in customer and "emailLabel" in customer,
      "Password recovery does not require the email field after the secure reset link returns")
check("list_public_restaurants" in customer and "place_customer_order" in customer,
      "Customer discovery and guarded checkout RPCs are wired")
check("ownerSettingOpen" in owner and "ownerSettingClose" in owner and "ownerSettingTempClosed" in owner and "ownerSettingDeliveryPaused" in owner,
      "Owner can configure operating hours, temporary closure and delivery pause")
check("function deliveryZoneRestaurantId(){return access.role==='owner'?access.restaurantId:'';}" in owner,
      "Owner delivery zones are scoped to the authenticated restaurant membership")
check("Temporarily closed" in customer and "delivery_paused" in customer,
      "Customer storefront communicates restaurant closure and delivery pause")
availability_migration = Path("supabase/20261108123000_bite_owner_availability_controls.sql").read_text(encoding="utf-8")
check("guard_marketplace_order_availability" in availability_migration and "delivery_paused" in availability_migration and "is_temporarily_closed" in availability_migration,
      "Database order trigger enforces temporary closure and delivery pause")
check("payment setup pending" in customer.lower() or "payment provider" in customer.lower(),
      "Customer checkout fails closed while no approved payment provider is configured")
check("const ownerPages=['overview','orders','menu','expenses','reports','settings']" in owner,
      "Owner navigation is restricted to the approved initial-release modules")
check("This account is linked to more than one restaurant" in owner,
      "Ambiguous multi-restaurant Owner accounts are blocked")
check("This restaurant has more than one Owner assignment" in owner,
      "Owner login blocks duplicate Owner assignments for a restaurant")
check("admin_list_owner_assignments" in owner and "admin_resolve_owner_mapping" in owner and "data-resolve-owner" in owner,
      "Platform Admin can inspect and resolve one-Owner-per-restaurant conflicts")
check("This action will be written to the Platform Audit Log" in owner,
      "Admin mapping resolution explains its audit trail before confirmation")
check("ownerProfileChangeForm" in owner and "ownerBankChangeForm" in owner and "admin_review_restaurant_change_request" in owner,
      "Owner profile and bank changes use Admin approval requests")
check("ownerIdentityApprovalNote" in owner and "restaurant_change_requests" in owner,
      "Restaurant identity changes are routed through the approval request UI")
change_migration = Path("supabase/20261108150000_bite_restaurant_change_request_approval.sql").read_text(encoding="utf-8")
check("prevent_unapproved_restaurant_identity_change" in change_migration and "restaurant_payout_profiles" in change_migration and "admin_review_restaurant_change_request" in change_migration and "ENABLE ROW LEVEL SECURITY" in change_migration,
      "Identity changes are database-guarded and payout details require Admin approval")
owner_mapping_migration = Path("supabase/20261108130000_bite_admin_owner_mapping_resolution.sql").read_text(encoding="utf-8")
check("platform_audit_logs" in owner_mapping_migration and "owner_mapping_resolved" in owner_mapping_migration,
      "Owner mapping changes are recorded in the database Platform Audit Log")
check("if(ooo)ooo.textContent=String(onlineToday);" in owner and "String(onlineToday.length)" not in owner,
      "Owner online-order KPI renders its numeric count without undefined")
check("const liveOrders=dashboardOrders.filter(o=>!o.isDemo)" in owner and "verifiedPaidSales" in owner and "customer_payable_amount" in owner and "money(verifiedPaidSales)" in owner,
      "Owner and Admin sales KPIs exclude demo and unpaid orders")
check("if(c.includes('bite demo simulation'))return 'website';" in owner and "DEMO ONLY" in owner,
      "Monthly demo orders appear in the website order board with a clear DEMO ONLY marker")
check("data-owner-dashboard" in owner and "data-platform-dashboard" in owner,
      "Owner and Platform Admin workspaces are separate")
check('#mainApp[style*="display:none"]{display:none!important}' in owner,
      "Owner and Admin workspace remains hidden before authentication at mobile widths")
check("const platformPages=['overview','restaurants','orders','financials','audit','support','moderation']" in owner and "loadAuditLogWorkspace" in owner and "platform_audit_logs" in owner,
      "Platform Admin audit log viewer is available only in the Admin workspace")
check("setRestaurantApproval" in owner and "onboardingStatus" in owner,
      "Platform Admin has explicit restaurant approve/reject/suspend/reactivate controls")
check("access.role==='owner'&&!['overview','orders','menu','expenses','reports','settings'].includes(id)" in owner,
      "Owner route guard blocks legacy POS, stock, tables, khata and HR pages")
check("Manual POS / offline order entry Bite ke initial marketplace version mein enabled nahi hai." in owner,
      "Legacy manual POS order creation is disabled in the marketplace MVP")
check("deliveryType:x.delivery_type" in owner and "shareDeliveryHandoff" in owner,
      "Owner order model carries delivery type for delivery handoff actions")
check("orderChannelKey(order.channel)==='website'" in owner and "['website','zomato','swiggy']" not in owner,
      "Owner new-order alerts are limited to BITE website orders")
check("isDemo:!!x.is_demo" in owner and "biteDemoBanner" in owner,
      "Simulated order records are explicitly marked in the Owner workspace")
check("get_delivery_handoff" in delivery and "confirm_delivery_handoff" in delivery,
      "Delivery link and OTP confirmation RPCs are wired")
for filename, source in (("customer.html", customer), ("index.html", owner), ("delivery.html", delivery)):
    check("service_role" not in source.lower() and "sb_secret_" not in source,
          f"{filename}: no service-role or Supabase secret key literal exposed")
print("Bite static QA passed.")
