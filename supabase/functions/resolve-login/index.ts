// FSMB · resolve-login Edge Function
// Lets people sign in with a login name: returns the account email for an active login name, else null.
// The app shows one generic error either way, so login names cannot be probed from the sign-in form.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/http.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { login } = await req.json().catch(() => ({ login: "" }));
  const name = String(login ?? "").trim().toLowerCase();
  // Constant small delay regardless of outcome.
  await new Promise((r) => setTimeout(r, 250));
  if (!name || name.length > 60) return json({ email: null });
  const { data } = await admin.from("profiles").select("email, active").eq("login_name", name).maybeSingle();
  return json({ email: data?.active ? data.email : null });
});
