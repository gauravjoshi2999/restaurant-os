"""Ensure live smoke can never initiate a transaction or send customer details."""
import unittest
from scripts.live_public_guest_browser import allow_request, READ_ONLY_RPCS


class GuestLiveRequestSafetyTests(unittest.TestCase):
    def test_allows_public_html_static_and_read_only_storefront_requests(self):
        self.assertTrue(allow_request(
            "https://gauravjoshi2999.github.io/restaurant-os/customer.html", "GET"))
        self.assertTrue(allow_request(
            "https://gauravjoshi2999.github.io/restaurant-os/index.html", "GET"))
        self.assertTrue(allow_request(
            "https://wedbgpybbgsszcmffoha.supabase.co/rest/v1/menu_items", "GET"))
        for rpc in READ_ONLY_RPCS:
            self.assertTrue(allow_request(
                "https://wedbgpybbgsszcmffoha.supabase.co/rest/v1/rpc/" + rpc, "POST"))

    def test_blocks_every_order_payment_financial_and_account_mutation(self):
        for path in [
            "/rest/v1/orders",
            "/rest/v1/order_financials",
            "/rest/v1/customer_addresses",
            "/rest/v1/rpc/bite_prepare_checkout_v2",
            "/rest/v1/rpc/create_customer_order_request",
            "/rest/v1/rpc/bite_finalize_verified_live_checkout",
            "/rest/v1/rpc/cancel_order",
            "/functions/v1/bite-live-create-session",
            "/functions/v1/bite-live-verify-checkout",
            "/functions/v1/bite-cashfree-operations",
            "/auth/v1/token",
            "/storage/v1/object/public/bite-menu/evil"
        ]:
            self.assertFalse(allow_request(
                "https://wedbgpybbgsszcmffoha.supabase.co" + path, "POST"),
                "Unsafe POST must never be sent: " + path)
        for method in ("PATCH", "PUT", "DELETE"):
            self.assertFalse(allow_request(
                "https://wedbgpybbgsszcmffoha.supabase.co/rest/v1/orders", method))
        self.assertFalse(allow_request("https://api.cashfree.com/pg/orders", "GET"))
        self.assertFalse(allow_request("https://api.cashfree.com/pg/orders", "POST"))
        self.assertFalse(allow_request("https://evil.example/login", "POST"))

    def test_method_and_url_parse_are_case_insensitive(self):
        self.assertTrue(allow_request(
            "https://wedbgpybbgsszcmffoha.supabase.co/rest/v1/rpc/list_public_restaurants", "post"))
        self.assertFalse(allow_request(
            "https://wedbgpybbgsszcmffoha.supabase.co/rest/v1/rpc/admin_delete_restaurant", "POST"))


if __name__ == "__main__":
    unittest.main()
