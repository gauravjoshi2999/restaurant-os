import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createSandboxHandler } from "./handler.mjs";

const env = (name: string) => Deno.env.get(name);
const url = env("SUPABASE_URL") ?? "";

function serviceClient() {
 return createClient(url, env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false }
 });
}

Deno.serve(createSandboxHandler({
 env,
 async authenticate(authorization: string) {
  const client = createClient(url, env("SUPABASE_ANON_KEY") ?? "", {
   global: { headers: { Authorization: authorization } }
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user?.id ?? null;
 },
 async prepare(args: Record<string, unknown>) {
  return await serviceClient().rpc("bite_prepare_subscription_sandbox", args);
 },
 async receipt(args: Record<string, unknown>) {
  return await serviceClient().rpc("bite_subscription_sandbox_receipt", args);
 }
}));
