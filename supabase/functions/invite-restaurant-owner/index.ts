import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return reply(401, { error: "Admin login required." });
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anonKey || !serviceKey) {
      console.error("Required Supabase function environment variables are missing.");
      return reply(500, { error: "Owner invitation service is not configured." });
    }
    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData.user) return reply(401, { error: "Admin session is invalid or expired." });
    const { data: isAdmin, error: adminCheckError } = await caller.rpc("is_platform_admin");
    if (adminCheckError || isAdmin !== true) return reply(403, { error: "Only Super Admin can invite restaurant owners." });
    const body = await req.json();
    const restaurantId = String(body.restaurantId || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) return reply(400, { error: "Please select a valid restaurant." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply(400, { error: "Please enter a valid owner email address." });
    if (fullName.length > 120) return reply(400, { error: "Owner name is too long." });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: restaurant, error: restaurantError } = await admin.from("restaurants").select("id,name").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant) return reply(404, { error: "Restaurant not found." });
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { data: fullName ? { full_name: fullName } : {} });
    if (inviteError || !invited.user) {
      const message = inviteError?.message || "Invitation could not be created.";
      const alreadyExists = /already|registered|exists/i.test(message);
      return reply(alreadyExists ? 409 : 400, { error: alreadyExists ? "This email may already have a RestaurantOS account. Use a new email address for this invitation." : message });
    }
    const { error: membershipError } = await admin.from("restaurant_members").insert({ restaurant_id: restaurantId, user_id: invited.user.id, role: "owner" });
    if (membershipError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(invited.user.id);
      if (cleanupError) console.error("Invitation rollback cleanup failed.");
      console.error("Owner membership insert failed:", membershipError.message);
      return reply(500, { error: "Owner access could not be assigned. The invitation was rolled back; please retry." });
    }
    return reply(200, { success: true, restaurantId, restaurantName: restaurant.name, ownerEmail: email, role: "owner", invitationSent: true });
  } catch (error) {
    console.error("Owner invitation failed:", error instanceof Error ? error.message : "Unknown error");
    return reply(500, { error: "Owner invitation could not be completed. Please try again." });
  }
});