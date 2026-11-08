import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return reply(401, { error: "Super Admin login required." });

    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anonKey || !serviceKey) {
      console.error("Owner invitation service configuration is incomplete.");
      return reply(500, { error: "Owner invitation service is temporarily unavailable. Please contact support." });
    }

    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) return reply(401, { error: "Your Admin session has expired. Please sign in again." });

    const { data: isAdmin, error: adminCheckError } = await caller.rpc("is_platform_admin");
    if (adminCheckError || isAdmin !== true) return reply(403, { error: "Only Super Admin can assign restaurant owners." });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "Request details are invalid. Please reopen the Owner form and try again." });
    }

    const restaurantId = String(body.restaurantId || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) {
      return reply(400, { error: "Please select a valid restaurant." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return reply(400, { error: "Please enter a valid Owner email address." });
    }
    if (fullName.length > 120) return reply(400, { error: "Owner name must be 120 characters or fewer." });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants").select("id,name").eq("id", restaurantId).maybeSingle();
    if (restaurantError) {
      console.error("Restaurant lookup failed:", restaurantError.message);
      return reply(500, { error: "Restaurant details could not be verified. Please try again." });
    }
    if (!restaurant) return reply(404, { error: "This restaurant was not found. Refresh the page and try again." });

    // Look up an existing account first. Never create a duplicate account for a known email.
    let existingUser: { id: string; email?: string } | null = null;
    const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) {
      console.error("Account lookup failed:", listError.message);
      return reply(500, { error: "Existing Owner account could not be checked safely. Please retry." });
    }
    existingUser = usersPage.users.find((u) => (u.email || "").toLowerCase() === email) || null;

    let ownerUserId = existingUser?.id || "";
    let invitationSent = false;
    let existingAccountLinked = Boolean(existingUser);

    if (!existingUser) {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: fullName ? { full_name: fullName } : {},
      });
      if (inviteError || !invited.user) {
        console.error("New Owner invitation failed:", inviteError?.message || "No user returned");
        const msg = inviteError?.message || "";
        const alreadyExists = /already|registered|exists/i.test(msg);
        return reply(alreadyExists ? 409 : 400, {
          error: alreadyExists
            ? "This email already has an account. Please press Invite Owner again; the system will connect the existing account."
            : "The invitation email could not be created. Check the email address and Auth email delivery settings, then retry.",
        });
      }
      ownerUserId = invited.user.id;
      invitationSent = true;
    }

    const { data: currentMembership, error: membershipLookupError } = await admin
      .from("restaurant_members")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (membershipLookupError) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      console.error("Owner membership lookup failed:", membershipLookupError.message);
      return reply(500, { error: "Owner access could not be checked. No changes were saved; please retry." });
    }
    const { data: assignedOwners, error: ownerListError } = await admin
      .from("restaurant_members").select("user_id")
      .eq("restaurant_id", restaurantId).eq("role", "owner");
    if (ownerListError) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(500, { error: "Existing restaurant Owner assignments could not be verified. No access was changed." });
    }
    const conflictingOwners = (assignedOwners || []).filter((row) => row.user_id !== ownerUserId);
    if (conflictingOwners.length || (assignedOwners || []).length > 1) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(409, { error: "This restaurant already has a conflicting Owner assignment. Resolve the existing Owner mapping before adding another account." });
    }

    const { data: platformAdmin, error: platformAdminError } = await admin
      .from("platform_admins").select("user_id").eq("user_id", ownerUserId).maybeSingle();
    if (platformAdminError) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(500, { error: "Account permissions could not be checked. No access was changed." });
    }
    if (platformAdmin) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(409, { error: "A Platform Admin account cannot also be assigned as a Restaurant Owner." });
    }

    const { data: otherMemberships, error: otherMembershipError } = await admin
      .from("restaurant_members")
      .select("restaurant_id")
      .eq("user_id", ownerUserId)
      .neq("restaurant_id", restaurantId)
      .limit(1);
    if (otherMembershipError) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(500, { error: "Existing restaurant access could not be checked. No access was changed." });
    }
    if (otherMemberships?.length) {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(409, { error: "This account is already linked to another restaurant. Each Owner account can manage only one restaurant." });
    }

    if (currentMembership?.role === "owner") {
      if (invitationSent) await admin.auth.admin.deleteUser(ownerUserId);
      return reply(200, {
        success: true, alreadyAssigned: true, invitationSent: false,
        ownerEmail: email, restaurantName: restaurant.name,
        message: "This email is already assigned as this restaurant's Owner.",
      });
    }

    const { error: membershipError } = await admin
      .from("restaurant_members")
      .upsert(
        { restaurant_id: restaurantId, user_id: ownerUserId, role: "owner" },
        { onConflict: "restaurant_id,user_id" },
      );

    if (membershipError) {
      if (invitationSent) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(ownerUserId);
        if (cleanupError) console.error("New invite rollback could not remove pending account:", cleanupError.message);
      }
      console.error("Owner membership assignment failed:", membershipError.message);
      return reply(500, { error: "Owner account was not linked. No partial access was saved; please retry." });
    }

    return reply(200, {
      success: true,
      ownerEmail: email,
      restaurantName: restaurant.name,
      role: "owner",
      invitationSent,
      existingAccountLinked,
      upgradedMembership: Boolean(currentMembership && currentMembership.role !== "owner"),
      message: invitationSent
        ? "A new secure invitation was sent."
        : "The existing RestaurantOS account was connected. The Owner can use the same email and password.",
    });
  } catch (error) {
    console.error("Owner invitation unexpected failure:", error instanceof Error ? error.message : "Unknown error");
    return reply(500, { error: "Owner setup could not be completed due to a temporary system issue. Please retry." });
  }
});