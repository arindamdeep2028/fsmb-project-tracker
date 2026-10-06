// FSMB · resolve-login Edge Function
// Lets people sign in with a login name: returns the account email for an active login name, else null.
// Server-to-server only: the Next.js sign-in action sends the shared secret LOGIN_RESOLVER_SECRET (./handler.ts);
// the email goes straight into the password check on the server and never reaches the browser. No CORS headers:
// browsers have no business calling this.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleResolveLogin } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => null) : null;
  // Constant small delay regardless of outcome.
  await new Promise((r) => setTimeout(r, 250));
  const r = await handleResolveLogin({ method: req.method, secretHeader: req.headers.get("x-login-resolver-secret"), body }, {
    secret: Deno.env.get("LOGIN_RESOLVER_SECRET") ?? undefined,
    async lookup(loginName) {
      const { data, error } = await admin.from("profiles").select("email, active").eq("login_name", loginName).maybeSingle();
      if (error) throw new Error("lookup unavailable");
      return data;
    },
  });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
});
