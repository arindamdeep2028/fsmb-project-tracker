import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Calls a Supabase Edge Function. The service-role key lives only inside the function (v2 §14.10);
 * the app forwards the signed-in user's token so the function can check who is asking. Signed-out calls
 * (asUser: false) carry the public anon key, which only gets them past the functions gateway; `headers` adds
 * server-only values such as the login resolver's shared secret.
 */
export async function callEdge<T = unknown>(name: string, body: unknown, opts: { asUser?: boolean; headers?: Record<string, string> } = { asUser: true }):
  Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
    ...opts.headers,
  };
  if (opts.asUser) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST", headers, body: JSON.stringify(body), cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: json.message ?? "The request could not be completed." };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, message: "The account service is not reachable. Try again in a minute." };
  }
}
