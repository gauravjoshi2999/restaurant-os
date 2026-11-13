import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MOBILE = /^\+91([6-9][0-9]{9})$/;
const ALIAS = /^owner-91([6-9][0-9]{9})@restaurantos\.test$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join("");
}

/**
 * Reset only the existing, uniquely assigned Owner of the selected restaurant.
 * Never select accounts by an arbitrary phone number supplied from the browser.
 * Phone-only legacy accounts are upgraded IN PLACE so historical user IDs,
 * restaurant memberships, order records and permissions are preserved.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!token || !url || !anonKey || !serviceKey) {
      return reply(401, { error: "Super Admin login required." });
    }

    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authenticated, error: authError } = await caller.auth.getUser(token);
    if (authError || !authenticated.user) return reply(401, { error: "Admin session expired." });
    const { data: allowed, error: permissionError } = await caller.rpc("is_platform_admin");
    if (permissionError || allowed !== true) return reply(403, { error: "Only Super Admin can reset Owner passwords." });

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return reply(400, { error: "Invalid request body." }); }
    const restaurantId = String(body.restaurantId || "").trim();
    if (!UUID.test(restaurantId)) return reply(400, { error: "Valid restaurant is required." });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: restaurant, error: restaurantError } = await admin.from("restaurants")
      .select("id,name").eq("id", restaurantId).maybeSingle();
    if (restaurantError) return reply(500, { error: "Could not verify restaurant." });
    if (!restaurant) return reply(404, { error: "Restaurant not found." });

    const { data: owners, error: ownersError } = await admin.from("restaurant_members")
      .select("user_id").eq("restaurant_id", restaurantId).eq("role", "owner");
    if (ownersError) return reply(500, { error: "Could not verify Owner mapping." });
    if (!owners?.length) return reply(409, {
      error: "Is restaurant ka Owner login abhi linked nahi hai. Owner account mapping se Create Owner Login karein.",
      code: "OWNER_MISSING",
    });
    if (owners.length !== 1) return reply(409, {
      error: "Is restaurant me multiple Owner assignments hain. Pehle mapping resolve karein.",
      code: "OWNER_MAPPING_CONFLICT",
    });

    const ownerId = owners[0].user_id;
    const { data: memberships, error: membershipsError } = await admin.from("restaurant_members")
      .select("restaurant_id,role").eq("user_id", ownerId);
    if (membershipsError || !memberships || memberships.length !== 1 || memberships[0].restaurant_id !== restaurantId || memberships[0].role !== "owner") {
      return reply(409, { error: "Owner account ek se zyada restaurant se linked hai, ya mapping invalid hai. Pehle mapping fix karein." });
    }

    const { data: platformAdmin, error: platformAdminError } = await admin.from("platform_admins")
      .select("user_id").eq("user_id", ownerId).maybeSingle();
    if (platformAdminError) return reply(500, { error: "Could not verify account privileges." });
    if (platformAdmin) return reply(403, { error: "Platform Admin account ka password yahan reset nahi kiya ja sakta." });

    const { data: ownerData, error: lookupError } = await admin.auth.admin.getUserById(ownerId);
    const owner = ownerData?.user;
    if (lookupError || !owner) return reply(409, { error: "Mapped Owner Auth account nahi mila. Owner mapping review karein." });

    // Use the existing verified email login when available.
    // A legacy phone-only login receives a synthetic email alias on the SAME Auth user.
    const currentEmail = String(owner.email || "").toLowerCase().trim();
    const currentPhone = String(owner.phone || "").trim();
    let loginIdentifier = currentEmail;
    let sharePhone: string | null = MOBILE.test(currentPhone) ? currentPhone : null;
    const update: Record<string, unknown> = {
      password: temporaryPassword(),
      app_metadata: { ...(owner.app_metadata || {}), must_change_password: true },
    };
    let migrated = false;
    const aliasMatch = currentEmail.match(ALIAS);

    if (aliasMatch) {
      loginIdentifier = aliasMatch[1];
      sharePhone = "+91" + aliasMatch[1];
    } else if (!currentEmail) {
      const number = currentPhone.match(MOBILE);
      if (!number) return reply(409, {
        error: "Owner account me verified email ya valid mobile nahi hai. Pehle Super Admin se account details verify karayein.",
        code: "LOGIN_IDENTIFIER_MISSING",
      });
      loginIdentifier = number[1];
      sharePhone = currentPhone;
      update.email = "owner-91" + number[1] + "@restaurantos.test";
      update.email_confirm = true;
      update.user_metadata = {
        ...(owner.user_metadata || {}),
        login_phone: currentPhone,
        auth_method: "phone_password_alias",
      };
      migrated = true;
    } else if (!owner.email_confirmed_at) {
      // Do not silently verify a real email address during an Admin password reset.
      return reply(409, {
        error: "Owner ka email abhi verify nahi hai. Pehle email invitation/verification complete karein.",
        code: "EMAIL_UNCONFIRMED",
      });
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(ownerId, update);
    if (updateError) {
      console.error("Owner password update failed", { restaurantId, ownerId, error: updateError.message });
      return reply(409, {
        error: migrated
          ? "Purana Phone Auth login bina duplicate account banaye migrate nahi ho saka. Owner mapping aur mobile alias collision check karein."
          : "Owner password reset nahi ho paya. Please retry.",
      });
    }

    console.info("Owner password reset", { adminId: authenticated.user.id, restaurantId, ownerId, migrated });
    return reply(200, {
      success: true,
      restaurantName: restaurant.name,
      loginIdentifier,
      phone: sharePhone,
      migrated,
      temporaryPassword: update.password,
    });
  } catch (error) {
    console.error("Owner reset unexpected failure", error instanceof Error ? error.message : "Unknown error");
    return reply(500, { error: "Owner password reset could not be completed." });
  }
});
