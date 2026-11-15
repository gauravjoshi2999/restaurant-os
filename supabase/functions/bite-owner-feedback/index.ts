import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROJECT = "https://wedbgpybbgsszcmffoha.supabase.co";
const ALLOWED_ORIGINS = new Set(["https://gauravjoshi2999.github.io", PROJECT]);
const kinds = new Set(["dhaba","family_restaurant","cafe_fastfood","hotel_restaurant","cloud_kitchen","other"]);
const teams = new Set(["1-3","4-10","11-25","26+"]);
const methods = new Set(["register","whatsapp","excel","software","mixed","other"]);
const problems = new Set(["billing","orders","staff","stock","accounting","online_orders","payments","marketing","remote","other"]);
const features = new Set(["fast_pos","qr_menu","live_orders","whatsapp_bills","expenses","inventory","staff","customers","delivery","remote","other"]);

const platforms = new Set(["zomato","swiggy","magicpin","own_website","other","none"]);
const marketplaceImprovements = new Set(["fees","discounts","settlements","visibility","customer_relationships","delivery","cancellation","support","promotions","reports","no_issue","other"]);
const platformNoUseReasons = new Set(["not_needed","cost","delivery","staff","not_familiar","direct_sales","other"]);
const motivators = new Set(["easy_demo","transparent_price","simple_hindi","data_safety","import_data","local_support","more_sales","single_system","not_interested"]);
const demoTypes = new Set(["video","whatsapp","call","in_person","no"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : PROJECT,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store",
  };
}
function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" } });
}
const str = (v: unknown, limit: number) => (typeof v === "string" ? v.trim().slice(0, limit) : "");
function chosen(v: unknown, allowed: Set<string>, maximum: number) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.has(x)))].slice(0, maximum);
}
function adminHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) h.Authorization = "Bearer " + key;
  return h;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response(null, {
      status: 302,
      headers: { ...cors(req), "Location": "https://gauravjoshi2999.github.io/restaurant-os/owner-feedback.html", "Cache-Control": "no-store" }
    });
  }
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, 403, { error: "यह request स्वीकार नहीं की जा सकती।" });

  const headerLength = Number(req.headers.get("content-length") || 0);
  if (headerLength > 25000) return json(req, 413, { error: "जवाब बहुत लंबा है।" });
  let data: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 25000) return json(req, 413, { error: "जवाब बहुत लंबा है।" });
    data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Invalid input");
  } catch {
    return json(req, 400, { error: "Form data ठीक नहीं है। फिर कोशिश करें।" });
  }
  if (str(data.website, 300)) return json(req, 200, { ok: true }); // invisible honeypot
  const elapsed = Number(data.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < 2000 || elapsed > 7200000) {
    return json(req, 400, { error: "Form पूरा करके दोबारा भेजें।" });
  }

  const city = str(data.city, 80);
  const real_story = str(data.real_story, 2000);
  const one_change = str(data.one_change, 1800);
  const biggest_problems = chosen(data.biggest_problems, problems, 10);
  if (city.length < 2 || real_story.length < 20 || one_change.length < 12 || biggest_problems.length === 0 || data.privacy_agreed !== true) {
    return json(req, 400, { error: "ज़रूरी सवाल पूरे भरें और अनुमति दें।" });
  }
  const restaurant_kind = str(data.restaurant_kind, 30);
  const team_size = str(data.team_size, 12);
  const existing_method = str(data.existing_method, 30);
  if ((restaurant_kind && !kinds.has(restaurant_kind)) || (team_size && !teams.has(team_size)) || (existing_method && !methods.has(existing_method))) {
    return json(req, 400, { error: "कृपया विकल्प सही चुनें।" });
  }

  const hasV2Fields = Array.isArray(data.marketplace_platforms);
  const marketplace_platforms = chosen(data.marketplace_platforms, platforms, 6);
  if (hasV2Fields && marketplace_platforms.length === 0) return json(req, 400, { error: "कृपया बताइए कि कौन-से online platforms इस्तेमाल करते हैं।" });
  if (marketplace_platforms.includes("none") && marketplace_platforms.length > 1) return json(req, 400, { error: "कृपया online platforms की जानकारी ठीक करें।" });
  const marketplace_nonuse_reason = str(data.marketplace_nonuse_reason, 30);
  if (marketplace_nonuse_reason && !platformNoUseReasons.has(marketplace_nonuse_reason)) return json(req, 400, { error: "Platform का विकल्प ठीक नहीं है।" });
  const demo_preference = str(data.demo_preference, 30);
  if (demo_preference && !demoTypes.has(demo_preference)) return json(req, 400, { error: "Demo का विकल्प ठीक नहीं है।" });
  const allOpportunities = chosen(data.marketplace_opportunities, marketplaceImprovements, 12);
  const marketplace_opportunities = marketplace_platforms.includes("none")
      ? [] : allOpportunities.includes("no_issue") ? ["no_issue"] : allOpportunities;
  const allMotivators = chosen(data.switch_motivators, motivators, 9);
  const switch_motivators = allMotivators.includes("not_interested") ? ["not_interested"] : allMotivators;

  const phone = str(data.owner_phone, 15);
  const contactConsent = data.contact_consent === true;
  if (contactConsent && !/^\+?[0-9 \-]{10,15}$/.test(phone)) {
    return json(req, 400, { error: "संपर्क नंबर जाँचकर भरें।" });
  }
  if (data.pilot_interest === true && (!contactConsent || !phone)) {
    return json(req, 400, { error: "Trial के लिए WhatsApp नंबर और संपर्क की अनुमति दें।" });
  }

  const secretConfig = Deno.env.get("SUPABASE_SECRET_KEYS");
  let key = "";
  try { if (secretConfig) key = JSON.parse(secretConfig).default || ""; } catch { /* fall back */ }
  key ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) return json(req, 503, { error: "Server configuration incomplete" });
  const headers = adminHeaders(key);

  // Only a salted fingerprint is saved; raw IP is never persisted.
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
  let fingerprint: string | null = null;
  if (ip) {
    const bytes = new TextEncoder().encode(ip + "|bite-owner-survey|" + key);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    fingerprint = Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, "0")).join("");
  }

  if (fingerprint) {
    const since = new Date(Date.now() - 3600000).toISOString();
    const url = PROJECT + "/rest/v1/bite_owner_feedback?select=id&request_fingerprint=eq." +
      encodeURIComponent(fingerprint) + "&created_at=gte." + encodeURIComponent(since) + "&limit=9";
    try {
      const rl = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!rl.ok) throw new Error("Unable to enforce limits");
      const recent = await rl.json();
      if (Array.isArray(recent) && recent.length >= 8) return json(req, 429, { error: "एक घंटे में बहुत जवाब आ गए हैं। थोड़ी देर बाद दोबारा कोशिश करें।" });
    } catch {
      return json(req, 503, { error: "अभी server busy है। थोड़ी देर बाद कोशिश करें।" });
    }
  }

  const record = {
    survey_version: hasV2Fields ? 2 : 1,
    restaurant_name: str(data.restaurant_name, 100) || null,
    city,
    restaurant_kind: restaurant_kind || null,
    team_size: team_size || null,
    owner_name: str(data.owner_name, 90) || null,
    owner_phone: contactConsent ? phone : null,
    existing_method: existing_method || null,
    biggest_problems,
    real_story,
    wish_list: chosen(data.wish_list, features, 11),
    one_change,
    other_ideas: str(data.other_ideas, 2500) || null,
    marketplace_platforms,
    marketplace_opportunities,
    marketplace_best_part: marketplace_platforms.includes("none") ? null : str(data.marketplace_best_part, 900) || null,
    marketplace_wish: marketplace_platforms.includes("none") ? null : str(data.marketplace_wish, 1200) || null,
    marketplace_nonuse_reason: marketplace_platforms.includes("none") ? marketplace_nonuse_reason || null : null,
    pos_brand: str(data.pos_brand, 110) || null,
    pos_best_part: str(data.pos_best_part, 900) || null,
    pos_improvement: str(data.pos_improvement, 1200) || null,
    switch_motivators,
    demo_preference: demo_preference || null,
    pilot_interest: data.pilot_interest === true && contactConsent,
    contact_consent: contactConsent,
    privacy_agreed: true,
    request_fingerprint: fingerprint
  };
  try {
    const saved = await fetch(PROJECT + "/rest/v1/bite_owner_feedback", {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(10000)
    });
    if (!saved.ok) {
      console.error("bite_owner_feedback insert failed", saved.status);
      return json(req, 503, { error: "अभी जवाब save नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।" });
    }
    return json(req, 201, { ok: true });
  } catch {
    return json(req, 503, { error: "Network समस्या है। दोबारा कोशिश करें।" });
  }
});
